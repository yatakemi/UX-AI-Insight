'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';

interface InteractiveElement {
  tagName: string;
  textContent: string;
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

interface PreviousAction {
  action: string;
  selector: string;
  value?: string;
}

interface StepData {
  action: {
    action: string;
    selector: string;
    reason: string;
    value?: string; // Add value here as well, as the API might return it for fill/navigate
  };
  newState: {
    html: string;
    screenshot: string;
    interactiveElements: InteractiveElement[];
  };
  currentStep: number;
  analysisResult?: string; // Add analysisResult here
}

export default function Interactive() {
  const [url, setUrl] = useState<string>(
    typeof window !== 'undefined'
      ? window.location.origin + '/dummy-ec-site/index.html'
      : ''
  );
  const [task, setTask] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stepRefs = useRef(new Map<number, HTMLDivElement>());

  const maxSteps = 5; // Define a maximum number of steps to prevent infinite loops

  useEffect(() => {
    if (steps.length > 0) {
      const lastStepIndex = steps.length - 1;
      const lastStepRef = stepRefs.current.get(lastStepIndex);
      if (lastStepRef) {
        lastStepRef.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [steps]);

  const startAnalysis = async (
    currentUrl: string,
    currentTask: string,
    currentStep: number,
    previousActions: PreviousAction[]
  ) => {
    if (currentStep >= maxSteps) {
      setError('Maximum analysis steps reached.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/interactive-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: currentUrl,
          task: currentTask,
          currentStep,
          previousActions,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '分析中にエラーが発生しました。');
      }

      const data: StepData = await response.json();
      setSteps((prevSteps) => [...prevSteps, data]);

      if (data.analysisResult) {
        // If analysisResult is present, it means the task is finished or an analysis was triggered
        setIsLoading(false);
        return;
      }

      // Prepare for the next step
      const nextPreviousActions = [
        ...previousActions,
        {
          action: data.action.action,
          selector: data.action.selector,
          ...(data.action.value !== undefined
            ? { value: data.action.value }
            : {}), // Conditionally add value
        },
      ];

      // Recursively call for the next step
      if (data.currentStep < maxSteps) {
        await startAnalysis(
          currentUrl,
          currentTask,
          data.currentStep,
          nextPreviousActions
        );
      }
    } catch (err: unknown) {
      throw err; // Re-throw the error so handleSubmit's catch block can handle it
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSteps([]); // Clear previous steps on new submission
    setIsLoading(true); // Set loading at the very beginning of the process
    setError(null); // Clear any previous errors

    try {
      await startAnalysis(url, task, 0, []); // Start the analysis from step 0 with no previous actions
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred');
      }
    } finally {
      setIsLoading(false); // Always stop loading when the entire process is done
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-gray-300 flex flex-col items-center justify-center p-6 font-sans antialiased">
      <div className="max-w-4xl w-full mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl leading-tight font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-3 drop-shadow-lg">
            UX-AI Insight
          </h1>
          <p className="text-lg text-gray-400">
            AI-powered interactive UX analysis with a touch of flair
          </p>
        </div>

        <div className="bg-gray-950 p-8 rounded-xl shadow-2xl border border-gray-700/50 mb-10 transform transition-all duration-300 hover:scale-[1.01]">
          <form onSubmit={handleSubmit}>
            <div className="mb-5">
              <label
                htmlFor="url-input"
                className="block text-gray-400 text-sm font-medium mb-2"
              >
                Website URL
              </label>
              <p className="text-sm text-gray-500 mt-1">
                ※ PoCのため、URLはダミーサイトに固定されています。
              </p>
              <input
                type="url"
                id="url-input"
                className="w-full pl-4 pr-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-300"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                disabled
              />
            </div>
            <div className="mb-5">
              <label
                htmlFor="task-input"
                className="block text-gray-400 text-sm font-medium mb-2"
              >
                Task
              </label>
              <input
                type="text"
                id="task-input"
                className="w-full pl-4 pr-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-300"
                placeholder="e.g., 「Tシャツ」で商品を検索し、そのうちの一つの商品を選択して詳細を確認する"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-6 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
              disabled={isLoading}
            >
              {isLoading ? 'Analyzing...' : 'Start Analysis'}
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 px-5 py-4 rounded-md relative mb-10">
            <p>{error}</p>
          </div>
        )}

        {steps.length > 0 && (
          <div className="bg-gray-950 p-8 rounded-xl shadow-2xl border border-gray-700/50 mt-10 transform transition-all duration-300 hover:scale-[1.01]">
            <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-500 mb-6 drop-shadow-lg">
              Analysis Steps
            </h2>
            <div className="space-y-8">
              {steps.map((step, index) => (
                <div
                  key={index}
                  ref={(el) => {
                    if (el) stepRefs.current.set(index, el);
                    else stepRefs.current.delete(index);
                  }}
                  className="flex flex-col space-y-4 p-6 bg-gray-900 rounded-lg shadow-xl border border-gray-800/50"
                >
                  <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                    Step {step.currentStep}
                  </h3>
                  <div className="flex space-x-4">
                    <div className="flex-shrink-0">
                      <Image
                        src={`data:image/png;base64,${step.newState.screenshot}`}
                        alt={`Step ${step.currentStep} Screenshot`}
                        className="w-64 rounded-md border-2 border-purple-500 shadow-lg transition-transform duration-300 hover:scale-105"
                        width={256}
                        height={144}
                      />
                    </div>
                    <div className="flex-grow space-y-2">
                      <p className="text-purple-300 break-all">
                        <strong>Action:</strong> {step.action.action}
                      </p>
                      <p className="text-purple-300 break-all">
                        <strong>Selector:</strong> {step.action.selector}
                      </p>
                      <p className="text-purple-300 break-all">
                        <strong>Reason:</strong> {step.action.reason}
                      </p>
                    </div>
                  </div>
                  {step.newState.interactiveElements.length > 0 && (
                    <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-700 shadow-md">
                      <h4 className="text-lg font-semibold text-green-400 mb-2">
                        Interactive Elements:
                      </h4>
                      <ul className="list-disc list-inside text-gray-300 max-h-60 overflow-y-auto pr-2">
                        {step.newState.interactiveElements.map(
                          (element, elIndex) => (
                            <li key={elIndex} className="mb-1 break-all">
                              <strong>{element.tagName}</strong> (
                              {element.id && `id: ${element.id}, `}
                              {element.className &&
                                `class: ${element.className}, `}
                              {element.ariaLabel &&
                                `aria-label: ${element.ariaLabel}, `}
                              selector: {element.selector})
                              {element.textContent &&
                                `: "${element.textContent
                                  .trim()
                                  .substring(0, 50)}..."`}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                  {step.analysisResult && (
                    <div className="mt-6 p-6 bg-gradient-to-br from-purple-900 to-pink-900 rounded-xl shadow-2xl border border-purple-700">
                      <h4 className="text-xl font-bold text-white mb-3">
                        UX Analysis Result:
                      </h4>
                      <div className="prose prose-invert max-w-none text-gray-200">
                        <ReactMarkdown>{step.analysisResult}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <div className="mt-10 text-center">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-bold py-3 px-6 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-blue-500 transition-all duration-300 shadow-lg hover:shadow-xl"
            >
              ↑ 先頭に戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
