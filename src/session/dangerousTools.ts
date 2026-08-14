/** 检测工具是否为危险工具 */
export function isDangerousTool(name: string): boolean {
  const dangerousTools = ["Write", "Edit", "Bash", "NotebookEdit"];
  return dangerousTools.includes(name);
}