export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  /** 是否允许多选，默认 false */
  multiple?: boolean;
  /** 是否允许自定义输入，默认 true */
  custom?: boolean;
}

export interface AskRequest {
  id: string;
  questions: AskQuestion[];
}

export interface AskResult {
  /** 每个问题对应的答案数组（单选时只有一个元素） */
  answers: string[][];
  content: string;
  resultLabel: string;
}

let _nextId = 1;

export const createAskId = (): string => `ask_${Date.now()}_${_nextId++}`;

type Resolve = (answers: string[][]) => void;
type Reject = (reason: string) => void;

const pending = new Map<string, { resolve: Resolve; reject: Reject }>();

export const registerAskPending = (id: string, resolve: Resolve, reject: Reject): void => {
  pending.set(id, { resolve, reject });
};

export const resolveAsk = (id: string, answers: string[][]): void => {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.resolve(answers);
};

export const rejectAsk = (id: string): void => {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.reject("dismissed");
};

export const formatAskResult = (questions: AskQuestion[], answers: string[][]): AskResult => {
  const formatted = questions
    .map((q, i) => {
      const ans = answers[i];
      return `"${q.question}"="${ans?.length ? ans.join(", ") : "Unanswered"}"`;
    })
    .join(", ");

  return {
    answers,
    content: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
    resultLabel: `${questions.length} question${questions.length > 1 ? "s" : ""} answered`,
  };
};
