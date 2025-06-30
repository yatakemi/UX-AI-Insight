import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Browser, BrowserContext, chromium, Page } from 'playwright';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in .env.local');
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const MAX_TOTAL_STEPS = 5; // Define maximum total steps for the analysis

function getHostnameFromUrl(inputUrl: string): string | null {
  try {
    const url = new URL(inputUrl);
    return url.hostname;
  } catch (e) {
    console.error('Error in getHostnameFromUrl:', e);
    return null; // Invalid URL
  }
}

async function getPageState(page: Page) {
  const html = await page.content();
  const screenshotBuffer = await page.screenshot({ type: 'png' });
  const screenshot = screenshotBuffer.toString('base64');

  const interactiveElements = await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll(
        'a, button, input:not([type="hidden"]), select, textarea'
      )
    );
    return elements.map((el) => {
      const tagName = el.tagName.toLowerCase();
      const textContent = el.textContent?.trim().replace(/\s+/g, ' '); // Remove extra whitespace
      const id = el.id;
      const name = el.getAttribute('name');
      const className = el.className;
      const type = el.getAttribute('type');
      const href = el.getAttribute('href');
      const value = (el as HTMLInputElement).value;
      const placeholder = el.getAttribute('placeholder');
      const ariaLabel = el.getAttribute('aria-label');

      let selector = tagName;
      if (id) selector += `#${id}`;
      else if (className) selector += `.${className.split(' ')[0]}`;
      // Use first class for simplicity
      else if (name) selector += `[name="${name}"]`;
      else if (type) selector += `[type="${type}"]`;
      else if (ariaLabel) selector += `[aria-label="${ariaLabel}"]`;
      else if (placeholder) selector += `[placeholder="${placeholder}"]`;

      return {
        tagName,
        textContent,
        id,
        name,
        className,
        type,
        href,
        value,
        placeholder,
        ariaLabel,
        selector,
      };
    });
  });

  return { html, screenshot, interactiveElements };
}

interface InteractiveElement {
  tagName: string;
  textContent: string | undefined;
  id: string;
  name: string | null;
  className: string;
  type: string | null;
  href: string | null;
  value?: string;
  placeholder: string | null;
  ariaLabel: string | null;
  selector: string;
}

interface PageState {
  html: string;
  screenshot: string;
  interactiveElements: InteractiveElement[];
}

interface Action {
  action: string;
  selector?: string;
  value?: string;
  reason?: string;
}

export async function POST(req: NextRequest) {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  console.log('POST function started.');

  try {
    const { task, currentStep = 0, previousActions = [] } = await req.json();
    const host = req.headers.get('host');
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const url = `${protocol}://${host}/dummy-ec-site/index.html`;

    // If maximum steps reached, force finish action and perform analysis
    if (currentStep >= MAX_TOTAL_STEPS - 1) {
      console.log(
        'Maximum steps reached. Forcing finish action and performing analysis.'
      );
      let page: Page | null = null;
      let state: PageState = { html: '', screenshot: '', interactiveElements: [] };

      try {
        browser = await chromium.launch({
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
        });
        const context = await browser.newContext();
        page = await context.newPage();
        await page.goto(url);
        if (previousActions.length > 0) {
          for (const action of previousActions) {
            switch (action.action) {
              case 'click':
                if (action.selector) {
                  await page.click(action.selector);
                }
                break;
              case 'fill':
                if (action.selector && action.value !== undefined) {
                  await page.fill(action.selector, action.value);
                }
                break;
              case 'navigate':
                if (typeof action.value === 'string') {
                  const targetHostname = getHostnameFromUrl(action.value);
                  if (!host || !targetHostname || targetHostname !== host.split(':')[0]) {
                    console.error(
                      'Navigation to external URL blocked:',
                      action.value
                    );
                    throw new Error('Navigation to external URL is not allowed.');
                  }
                  await page.goto(action.value);
                } else {
                  console.error(
                    'Navigation action received with invalid URL:',
                    action.value
                  );
                  throw new Error('Invalid URL for navigation.');
                }
                break;
            }
          }
        }
        state = await getPageState(page);
      } catch (e) {
        console.error('Error during forced finish browser operations:', e);
      }

      const analysisPrompt = `
        あなたはウェブサイトのユーザーエクスペリエンスを評価するAIエージェントです。
        あなたの目標は次のとおりでした: ${task}
        実行されたアクションの履歴:
        ${JSON.stringify(previousActions, null, 2)}
        最終的なページの状態:
        - URL: ${page ? page.url() : url}
        - HTML (最初の5000文字): ${
          state.html ? state.html.substring(0, 5000) : ''
        }
        - インタラクティブな要素: ${
          state.interactiveElements
            ? JSON.stringify(state.interactiveElements, null, 2)
            : '[]'
        }

        このタスクの実行におけるユーザーエクスペリエンスの改善点を、以下の観点から詳細に分析し、提案してください。
        - ユーザビリティ（使いやすさ）
        - アクセシビリティ（利用しやすさ）
        - 視覚的魅力（デザイン）
        - 効率性（タスク完了までの時間や手順）
        - 満足度（ユーザーがタスクを完了した際の感情）

        改善点は、具体的なUI要素や操作フローに言及し、Markdown形式で箇条書きで記述してください。
      `;
      const analysisResultResponse = await model.generateContent(
        analysisPrompt
      );
      const analysisResult = analysisResultResponse.response.text();

      return NextResponse.json(
        {
          action: { action: 'finish', reason: 'Maximum steps reached.' },
          newState: state,
          currentStep: currentStep + 1,
          analysisResult,
        },
        { status: 200 }
      );
    }

    console.log(
      `Received request: URL=${url}, Task=${task}, CurrentStep=${currentStep}, PreviousActionsCount=${previousActions.length}`
    );

    

    if (!task || typeof task !== 'string') {
      console.error('Invalid task provided.', task);
      return NextResponse.json(
        { error: 'Invalid task provided.' },
        { status: 400 }
      );
    }

    console.log('Launching browser...');

    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    });
    console.log('Browser launched.');

    context = await browser.newContext();
    console.log('New context created.');

    page = await context.newPage();
    console.log('New page created.');

    console.log(`Navigating to initial URL: ${url}`);
    await page.goto(url); // Start from the initial URL
    console.log(`Navigated to initial URL: ${url}`);

    // If previous actions exist, re-execute them to restore the page state
    if (previousActions.length > 0) {
      console.log(`Re-executing ${previousActions.length} previous actions.`);
      for (const action of previousActions) {
        console.log(`Re-executing action: ${JSON.stringify(action)}`);
        try {
          switch (action.action) {
            case 'click':
              if (action.selector) {
                await page.click(action.selector);
              }
              break;
            case 'fill':
              if (action.selector && action.value !== undefined) {
                await page.fill(action.selector, action.value);
              }
              break;
            case 'navigate':
              if (typeof action.value === 'string') {
                await page.goto(action.value);
              } else {
                console.error(
                  'Navigation action received with invalid URL:',
                  action.value
                );
                throw new Error('Invalid URL for navigation.');
              }
              break;
            default:
              break;
          }
          console.log(`Re-executed action successfully: ${action.action}`);
        } catch (e) {
          console.error('Re-executing previous action failed:', action, e);
          throw new Error(
            `Failed to re-execute previous action: ${action.action} on ${
              action.selector
            }. Error: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      console.log('Finished re-executing previous actions.');
    }

    console.log('Getting page state...');
    let state = await getPageState(page!);
    console.log('Page state obtained.');

    let actionSuccess = false;
    let attempts = 0;
    const maxAttempts = 3;

    let action = null; // Initialize action outside the loop

    // Only execute one step per API call
    // The loop for retries is still here for robustness within a single step
    while (!actionSuccess && attempts < maxAttempts) {
      console.log(`Attempt ${attempts + 1} to get next action.`);
      const prompt = `
        あなたはウェブサイトのユーザーエクスペリエンスを評価するAIエージェントです。
        あなたの目標は次のとおりです: ${task}

        現在のページの状態:
        - URL: ${page.url()}
        - HTML (最初の5000文字): ${state.html.substring(0, 5000)}
        - インタラクティブな要素: ${JSON.stringify(
          state.interactiveElements,
          null,
          2
        )}

        ${
          attempts > 0
            ? `前のアクションが失敗しました。別の行動を検討してください。`
            : ''
        }

        次にとるべきアクションは何ですか？タスクが完了したと判断した場合は、"finish"アクションを提案してください。
        あなたの応答は、以下のプロパティを持つJSONオブジェクトである必要があります。
        - "action": 実行するアクションを説明する文字列（例: "click", "fill", "navigate", "finish"）
        - "selector": 操作する要素のCSSセレクター（該当する場合）
        - "value": 入力する値（"fill"アクションの場合）またはナビゲートするURL（"navigate"アクションの場合）
        - "reason": このアクションを実行する理由の簡単な説明（日本語）
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      let parsedAction: Action;
      try {
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
          parsedAction = JSON.parse(jsonMatch[1]);
        } else {
          // If no markdown JSON block is found, try to parse the whole response as JSON
          parsedAction = JSON.parse(responseText);
        }
      } catch (parseError) {
        console.error(
          'Failed to parse AI response as JSON:',
          responseText,
          parseError
        );
        throw new Error('AI response was not a valid JSON format.');
      }
      action = parsedAction;
      console.log(`AI proposed action: ${JSON.stringify(action)}`);

      if (action.action === 'finish') {
        actionSuccess = true; // Mark as success to exit the loop
        console.log('AI proposed finish action.');
        break; // Exit the while loop
      }

      try {
        console.log(`Executing action: ${action.action}`);
        switch (action.action) {
          case 'click':
            if (action.selector) {
              await page.click(action.selector);
            }
            break;
          case 'fill':
            if (action.selector && action.value !== undefined) {
              await page.fill(action.selector, action.value);
            }
            break;
          case 'navigate':
            if (typeof action.value === 'string') {
              const targetHostname = getHostnameFromUrl(action.value);
              if (!host || !targetHostname || targetHostname !== host.split(':')[0]) {
                console.error(
                  'Navigation to external URL blocked:',
                  action.value
                );
                throw new Error('Navigation to external URL is not allowed.');
              }
              await page.goto(action.value);
            } else {
              console.error(
                'Navigation action received with invalid URL:',
                action.value
              );
              throw new Error('Invalid URL for navigation.');
            }
            break;
          default:
            // Do nothing
            console.log('Unknown action, doing nothing.');
            break;
        }
        actionSuccess = true;
        console.log(`Action ${action.action} executed successfully.`);
      } catch (actionError: unknown) {
        console.error(`Action ${action.action} failed:`, actionError);
        attempts++;
        // Re-get page state after failed action to provide updated context to AI
        console.log('Re-getting page state after failed action...');
        state = await getPageState(page!);
        console.log('Page state re-obtained after failed action.');
      }
    }

    let analysisResult = null;
    if (action && action.action === 'finish') {
      console.log('Performing UX analysis...');
      const analysisPrompt = `
        あなたはウェブサイトのユーザーエクスペリエンスを評価するAIエージェントです。
        あなたの目標は次のとおりでした: ${task}
        実行されたアクションの履歴:
        ${JSON.stringify(previousActions, null, 2)}
        最終的なページの状態:
        - URL: ${page!.url()}
        - HTML (最初の5000文字): ${state.html.substring(0, 5000)}
        - インタラクティブな要素: ${JSON.stringify(
          state.interactiveElements,
          null,
          2
        )}

        このタスクの実行におけるユーザーエクスペリエンスの改善点を、以下の観点から詳細に分析し、提案してください。
        - ユーザビリティ（使いやすさ）
        - アクセシビリティ（利用しやすさ）
        - 視覚的魅力（デザイン）
        - 効率性（タスク完了までの時間や手順）
        - 満足度（ユーザーがタスクを完了した際の感情）

        改善点は、具体的なUI要素や操作フローに言及し、Markdown形式で箇条書きで記述してください。
      `;
      const analysisResultResponse = await model.generateContent(
        analysisPrompt
      );
      analysisResult = analysisResultResponse.response.text();
      console.log('UX analysis completed.');
    }

    if (!actionSuccess && (!action || action.action !== 'finish')) {
      console.error(`Action failed after ${maxAttempts} attempts. Aborting.`);
      return NextResponse.json(
        { error: `Action failed after ${maxAttempts} attempts. Aborting.` },
        { status: 500 }
      );
    }

    console.log('Getting final page state...');
    const newState = await getPageState(page!);
    console.log('Final page state obtained.');

    return NextResponse.json(
      { action, newState, currentStep: currentStep + 1, analysisResult },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('API Error:', error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
      console.log('Browser closed.');
    }
  }
}
