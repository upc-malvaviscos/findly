interface Repository {
  owner: string;
  repo: string;
}
interface Response<T> {
  data: T;
}
export interface MemoriaPull {
  merged: boolean;
  merge_commit_sha: string | null;
  changed_files: number;
  auto_merge: object | null;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
}
export interface MemoriaSourceGitHub {
  rest: {
    repos: {
      compareCommitsWithBasehead(
        input: Repository & { basehead: string; per_page: number },
      ): Promise<Response<{ status: string }>>;
      listPullRequestsAssociatedWithCommit(
        input: Repository & { commit_sha: string; per_page: number },
      ): Promise<Response<{ number: number }[]>>;
    };
    pulls: {
      get(
        input: Repository & { pull_number: number },
      ): Promise<Response<MemoriaPull>>;
      listFiles(
        input: Repository & {
          pull_number: number;
          per_page: number;
          page: number;
        },
      ): Promise<Response<{ filename: string; previous_filename?: string }[]>>;
    };
  };
}
export interface MemoriaSourceContext {
  eventName: string;
  ref: string;
  sha: string;
  repo: Repository;
  payload: {
    inputs?: { source_sha?: string };
    workflow_run?: {
      name: string;
      path?: string;
      conclusion: string;
      head_sha: string;
      head_repository: { full_name: string } | null;
      pull_requests?: { number: number }[];
    };
  };
}
export declare function affectsMemoria(path: string): boolean;
export declare function verifyMainCommit(
  github: {
    rest: {
      repos: Pick<
        MemoriaSourceGitHub['rest']['repos'],
        'compareCommitsWithBasehead'
      >;
    };
  },
  repository: Repository,
  sha: string,
): Promise<void>;
export declare function resolveMemoriaSource(input: {
  github: MemoriaSourceGitHub;
  context: MemoriaSourceContext;
  sleep?: (milliseconds: number) => Promise<unknown>;
}): Promise<{ sha: string; pullNumber: number } | undefined>;
