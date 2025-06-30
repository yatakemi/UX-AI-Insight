import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio'; // cheerioをインポート

// Google AI APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env.local');
  throw new Error('GEMINI_API_KEY is not set in .env.local');
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    console.log('Received URL:', url);

    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      console.error('Invalid URL provided:', url);
      return NextResponse.json({ error: 'Invalid URL provided.' }, { status: 400 });
    }

    // 1. HTMLコンテンツの取得とエンコーディング処理
    console.log('Fetching HTML from:', url);
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch URL ${url}: ${response.statusText}`);
      return NextResponse.json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: response.status });
    }

    const htmlContentBuffer = await response.arrayBuffer();
    let htmlContent: string;

    const contentType = response.headers.get('Content-Type');
    let charset = 'utf-8'; // デフォルトはUTF-8

    // Content-Typeヘッダーからcharsetを抽出
    if (contentType && contentType.includes('charset=')) {
      const charsetMatch = contentType.match(/charset=([^;]+)/i);
      if (charsetMatch && charsetMatch[1]) {
        charset = charsetMatch[1].toLowerCase();
        // 一般的なcharsetのエイリアスを正規化
        if (charset === 'shift_jis' || charset === 'x-sjis' || charset === 'windows-31j') {
          charset = 'shift-jis';
        } else if (charset === 'euc-jp') {
          charset = 'euc-jp';
        }
        // 必要に応じて他のエイリアスも追加
      }
    }

    try {
      const decoder = new TextDecoder(charset);
      htmlContent = decoder.decode(htmlContentBuffer);
      console.log(`Decoded HTML using charset: ${charset}. Length: ${htmlContent.length}`);
    } catch (e) {
      console.warn(`Failed to decode with ${charset}, falling back to utf-8. Error:`, e);
      // 指定されたcharsetでデコード失敗した場合、UTF-8にフォールバック
      const decoder = new TextDecoder('utf-8');
      htmlContent = decoder.decode(htmlContentBuffer);
      console.log(`Decoded HTML using fallback utf-8. Length: ${htmlContent.length}`);
    }

    // --- 新しいステップ: 非表示文字/制御文字のクリーンアップ ---
    // 印刷可能なASCII文字、一般的な日本語文字、改行・タブ以外の文字を削除
    htmlContent = htmlContent.replace(/[^\x20-\x7E\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFFEF\u4E00-\u9FFF\u000A\u000D\u0009]/g, '');
    console.log('Cleaned non-printable characters. Current length:', htmlContent.length);

    // 2. HTMLの前処理 (cheerioを使用し、可視テキストを抽出)
    console.log('Starting HTML preprocessing with cheerio (extracting text content)...');
    const $ = cheerio.load(htmlContent);

    // 不要な要素を削除 (可視テキストに影響しないもの)
    $('script').remove();
    $('style').remove();
    $('noscript').remove();
    $('link').remove(); // linkタグも削除
    $('meta').remove(); // metaタグも削除
    $('head').remove(); // headタグも削除

    // bodyタグ内の可視テキストを抽出
    let processedText = $('body').text() || '';

    // 複数行の改行を1つにまとめる
    processedText = processedText.replace(/\n\s*\n/g, '\n');
    // 余分な空白を削除
    processedText = processedText.replace(/\s\s+/g, ' ');
    // 先頭と末尾の空白をトリム
    processedText = processedText.trim();

    // トークン制限を考慮し、最大文字数を設定 (例: 10000文字)
    const MAX_TEXT_LENGTH = 5000; // テキストコンテンツの最大長を調整
    if (processedText.length > MAX_TEXT_LENGTH) {
      processedText = processedText.substring(0, MAX_TEXT_LENGTH) + '... (truncated)';
    }
    console.log('Processed text content. Length:', processedText.length);

    // 3. 構造化されたコンテンツの抽出
    let structuredContent = '';

    // 見出し
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      structuredContent += `Heading ${$(el).prop('tagName')}: ${$(el).text().trim()}\n`;
    });

    // リンク
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text) {
        structuredContent += `Link: "${text}" (URL: ${href})\n`;
      }
    });

    // ボタン
    $('button').each((i, el) => {
      const text = $(el).text().trim();
      if (text) {
        structuredContent += `Button: "${text}"\n`;
      }
    });

    // 入力フィールド (input, textarea, select)
    $('input, textarea, select').each((i, el) => {
      const type = $(el).attr('type') || el.tagName.toLowerCase();
      const name = $(el).attr('name');
      const id = $(el).attr('id');
      const placeholder = $(el).attr('placeholder');
      const label = $(`label[for="${id}"]`).text().trim() || $(el).prev('label').text().trim();
      let fieldInfo = `Input Field (Type: ${type})`;
      if (name) fieldInfo += `, Name: ${name}`;
      if (label) fieldInfo += `, Label: "${label}"`;
      if (placeholder) fieldInfo += `, Placeholder: "${placeholder}"`;
      structuredContent += `${fieldInfo}\n`;
    });

    // 画像 (alt属性を持つもの)
    $('img').each((i, el) => {
      const alt = $(el).attr('alt');
      const src = $(el).attr('src');
      if (alt) {
        structuredContent += `Image (Alt: "${alt}", Src: ${src})\n`;
      } else if (src) {
        structuredContent += `Image (Src: ${src}, No Alt Text)\n`;
      }
    });

    // トークン制限を考慮し、構造化コンテンツの最大文字数を設定
    const MAX_STRUCTURED_LENGTH = 5000;
    if (structuredContent.length > MAX_STRUCTURED_LENGTH) {
      structuredContent = structuredContent.substring(0, MAX_STRUCTURED_LENGTH) + '... (truncated)';
    }
    console.log('Structured content. Length:', structuredContent.length);

    // 4. AIへのプロンプト生成
    const prompt = `あなたはプロのUXデザイナーです。以下のウェブサイトのテキストコンテンツと構造情報を分析し、ユーザーエクスペリエンスを向上させるための具体的な改善点を3つ、簡潔な箇条書きで提案してください。特に、ナビゲーション、フォームの使いやすさ、情報の見つけやすさ、アクセシビリティに焦点を当ててください。

ウェブサイトのテキストコンテンツ:
${processedText}

ウェブサイトの構造情報:
${structuredContent}`;
    console.log('Prompt generated. Length:', prompt.length);

    // 4. Google AI (Gemini) API呼び出し
    console.log('Calling Gemini API... (before generateContent)');
    const result = await model.generateContent(prompt);
    console.log('Gemini API response received. (after generateContent)');
    const aiResponse = result.response.text();
    console.log('Gemini API response text extracted. Length:', aiResponse.length);

    // 5. レスポンスの整形
    console.log('AI Response (raw):', aiResponse);

    return NextResponse.json({ suggestions: aiResponse }, { status: 200 });

  } catch (error: unknown) {
    console.error('API Error caught in route.ts:', error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'An unexpected error occurred on the server.' }, { status: 500 });
  }
}