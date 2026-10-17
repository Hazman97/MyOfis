/** Chat messages are jobs underneath (budgets, office, approvals) but stay off the Board and its stats. */
export const isChatJob = (j: { type: string }) => j.type === "chat";

export const boardJobs = <T extends { type: string }>(jobs: T[]): T[] => jobs.filter((j) => !isChatJob(j));
