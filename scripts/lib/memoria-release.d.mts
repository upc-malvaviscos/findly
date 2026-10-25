export interface MemoriaAsset {
  name: string;
  state: string;
}
export interface MemoriaRelease {
  id: number;
  tag_name: string;
  target_commitish: string;
  body: string | null;
  draft: boolean;
  html_url: string;
  assets: MemoriaAsset[];
}
interface Repository {
  owner: string;
  repo: string;
}
interface Response<T> {
  data: T;
}
export interface MemoriaGitHub {
  paginate(
    method: unknown,
    input: Repository & { per_page: number },
  ): Promise<MemoriaRelease[]>;
  rest: {
    git: {
      getRef(input: Repository & { ref: string }): Promise<Response<unknown>>;
    };
    repos: {
      listReleases: unknown;
      compareCommitsWithBasehead(
        input: Repository & { basehead: string; per_page: number },
      ): Promise<Response<{ status: string }>>;
      getReleaseByTag(
        input: Repository & { tag: string },
      ): Promise<Response<MemoriaRelease>>;
      getCommit(
        input: Repository & { ref: string },
      ): Promise<Response<{ sha: string }>>;
      createRelease(
        input: Repository & {
          tag_name: string;
          target_commitish: string;
          name: string;
          body: string;
          draft: boolean;
          prerelease: boolean;
          make_latest: string;
        },
      ): Promise<Response<MemoriaRelease>>;
      uploadReleaseAsset(
        input: Repository & {
          release_id: number;
          name: string;
          data: Buffer;
          headers: { 'content-type': string; 'content-length': number };
        },
      ): Promise<Response<unknown>>;
      updateRelease(
        input: Repository & {
          release_id: number;
          draft: boolean;
          make_latest: string;
        },
      ): Promise<Response<MemoriaRelease>>;
    };
  };
}
export declare function memoriaTag(date: Date): string;
export declare function completedMemoriaRelease(
  github: MemoriaGitHub,
  repository: Repository,
  sha: string,
): Promise<string | undefined>;
export declare function publishMemoria(input: {
  github: MemoriaGitHub;
  context: {
    eventName: string;
    ref: string;
    sha: string;
    runId: number;
    repo: Repository;
  };
  pdfPath: string;
  sourceSha?: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<unknown>;
}): Promise<string>;
