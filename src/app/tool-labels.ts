export const getToolCallLabel = (callName: string, args: Record<string, unknown>): string => {
  const path = typeof args.path === "string" ? args.path : "";
  const command = typeof args.command === "string" ? args.command : "";

  if (callName === "read_file") return `Read ${path}`;
  if (callName === "write_file") return `Write ${path}`;
  if (callName === "edit_file") return `Edit ${path}`;
  if (callName === "bash") return `Bash ${command}`;
  if (callName === "todowrite") return "Update todos";
  if (callName === "rj_get_ranking") return `Ranking ${args.ranking_type ?? ""}`;
  if (callName === "rj_query") return "Query RJ";
  if (callName === "rj_get_detail") return `Detail ${args.rj_code ?? ""}`;
  if (callName === "rj_get_overview") return "RJ Overview";
  if (callName === "rj_add") return `Add RJ ${args.rj_code ?? ""}`;
  if (callName === "rj_remove") return `Remove RJ ${args.rj_code ?? ""}`;
  if (callName === "rj_check_exists") return "Check RJ Exists";
  if (callName === "circle_add") return `Add Circle ${args.name ?? ""}`;
  if (callName === "circle_remove") return `Remove Circle ${args.name ?? ""}`;
  if (callName === "circle_check_exists") return "Check Circle Exists";
  return callName;
};
