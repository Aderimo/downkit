import { create } from "zustand";
import { FINISHED_STATUSES, type Job } from "../types/jobs";

interface JobsState {
  jobs: Job[];
  add: (job: Job) => void;
  update: (id: string, patch: Partial<Job>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: [],
  add: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
  update: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    })),
  remove: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  clearFinished: () =>
    set((state) => ({
      jobs: state.jobs.filter((job) => !FINISHED_STATUSES.includes(job.status)),
    })),
}));

export function getJob(id: string): Job | undefined {
  return useJobsStore.getState().jobs.find((job) => job.id === id);
}

export function findJobByBackendId(backendJobId: string): Job | undefined {
  return useJobsStore.getState().jobs.find((job) => job.backendJobId === backendJobId);
}
