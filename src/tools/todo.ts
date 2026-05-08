export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export interface TodoWriteResult {
  todos: TodoItem[];
  content: string;
  displayText: string;
  resultLabel: string;
}

const todoStatuses = new Set<TodoStatus>(["pending", "in_progress", "completed", "cancelled"]);
const todoPriorities = new Set<TodoPriority>(["high", "medium", "low"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateTodos = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) throw new Error("todowrite: todos must be an array");

  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`todowrite: todo at index ${index} must be an object`);

    const { content, status, priority } = item;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`todowrite: todo at index ${index} requires non-empty content`);
    }
    if (typeof status !== "string" || !todoStatuses.has(status as TodoStatus)) {
      throw new Error(`todowrite: todo at index ${index} has invalid status`);
    }
    if (typeof priority !== "string" || !todoPriorities.has(priority as TodoPriority)) {
      throw new Error(`todowrite: todo at index ${index} has invalid priority`);
    }

    return {
      content: content.trim(),
      status: status as TodoStatus,
      priority: priority as TodoPriority,
    };
  });
};

const formatTodoList = (todos: TodoItem[]): string => {
  const lines = ["# Todos"];
  for (const todo of todos) {
    const checked = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "loading" : " ";
    lines.push(`[${checked}] ${todo.content}`);
  }
  return lines.join("\n");
};

export const todoWriteTool = (todosInput: unknown): TodoWriteResult => {
  const todos = validateTodos(todosInput);
  const remaining = todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length;
  return {
    todos,
    content: JSON.stringify(todos, null, 2),
    displayText: formatTodoList(todos),
    resultLabel: `${remaining} todos`,
  };
};
