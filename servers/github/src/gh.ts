/**
 * GitHub API layer over @octokit/rest. Each call builds an Octokit with the
 * currently-resolved token (so it picks up a fresh login). Wrappers return
 * trimmed, token-efficient objects rather than raw API payloads.
 */
import { Octokit } from "@octokit/rest";
import { getToken } from "./auth.js";
import { DEFAULT_PER_PAGE, VERSION } from "./config.js";

async function octo(): Promise<Octokit> {
  return new Octokit({ auth: await getToken(), userAgent: `mcp-github/${VERSION}` });
}

const cap = (n?: number) => Math.min(Math.max(n ?? DEFAULT_PER_PAGE, 1), 100);

export async function whoami() {
  const { data } = await (await octo()).rest.users.getAuthenticated();
  return { login: data.login, name: data.name, url: data.html_url, public_repos: data.public_repos, private_repos: data.total_private_repos };
}

export async function searchRepos(q: string, limit?: number) {
  const { data } = await (await octo()).rest.search.repos({ q, per_page: cap(limit) });
  return data.items.map((r) => ({ full_name: r.full_name, stars: r.stargazers_count, language: r.language, description: r.description, url: r.html_url }));
}

export async function searchCode(q: string, limit?: number) {
  const { data } = await (await octo()).rest.search.code({ q, per_page: cap(limit) });
  return data.items.map((i) => ({ repo: i.repository.full_name, path: i.path, url: i.html_url }));
}

export async function searchIssues(q: string, limit?: number) {
  const { data } = await (await octo()).rest.search.issuesAndPullRequests({ q, per_page: cap(limit) });
  return data.items.map((i) => ({ repo: i.repository_url.replace("https://api.github.com/repos/", ""), number: i.number, title: i.title, state: i.state, is_pr: !!i.pull_request, url: i.html_url }));
}

export async function getRepo(owner: string, repo: string) {
  const { data } = await (await octo()).rest.repos.get({ owner, repo });
  return {
    full_name: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    open_issues: data.open_issues_count,
    language: data.language,
    default_branch: data.default_branch,
    license: data.license?.spdx_id,
    url: data.html_url,
  };
}

export async function listIssues(owner: string, repo: string, state: "open" | "closed" | "all", limit?: number) {
  const { data } = await (await octo()).rest.issues.listForRepo({ owner, repo, state, per_page: cap(limit) });
  return data.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, comments: i.comments, url: i.html_url }));
}

export async function getIssue(owner: string, repo: string, issue_number: number) {
  const o = await octo();
  const { data } = await o.rest.issues.get({ owner, repo, issue_number });
  const { data: comments } = await o.rest.issues.listComments({ owner, repo, issue_number, per_page: 20 });
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    author: data.user?.login,
    body: data.body,
    url: data.html_url,
    comments: comments.map((c) => ({ author: c.user?.login, body: c.body })),
  };
}

export async function listPullRequests(owner: string, repo: string, state: "open" | "closed" | "all", limit?: number) {
  const { data } = await (await octo()).rest.pulls.list({ owner, repo, state, per_page: cap(limit) });
  return data.map((p) => ({ number: p.number, title: p.title, state: p.state, author: p.user?.login, draft: p.draft, url: p.html_url }));
}

export async function getPullRequest(owner: string, repo: string, pull_number: number) {
  const { data } = await (await octo()).rest.pulls.get({ owner, repo, pull_number });
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    author: data.user?.login,
    body: data.body,
    additions: data.additions,
    deletions: data.deletions,
    changed_files: data.changed_files,
    merged: data.merged,
    url: data.html_url,
  };
}

export async function getFileContents(owner: string, repo: string, p: string, ref?: string) {
  const { data } = await (await octo()).rest.repos.getContent({ owner, repo, path: p, ref });
  if (Array.isArray(data)) {
    return { type: "dir", entries: data.map((e) => ({ name: e.name, type: e.type, size: e.size })) };
  }
  if (data.type === "file" && "content" in data) {
    if (data.size > 1024 * 1024) return { type: "file", path: data.path, size: data.size, note: "file too large to inline" };
    return { type: "file", path: data.path, size: data.size, content: Buffer.from(data.content, "base64").toString("utf8") };
  }
  return { type: data.type };
}

export async function listNotifications(limit?: number) {
  const { data } = await (await octo()).rest.activity.listNotificationsForAuthenticatedUser({ per_page: cap(limit) });
  return data.map((n) => ({ repo: n.repository.full_name, subject: n.subject.title, type: n.subject.type, reason: n.reason, unread: n.unread }));
}

export async function rateLimit() {
  const { data } = await (await octo()).rest.rateLimit.get();
  const core = data.resources.core;
  return { limit: core.limit, remaining: core.remaining, reset: new Date(core.reset * 1000).toISOString() };
}

export async function createIssue(owner: string, repo: string, title: string, body?: string) {
  const { data } = await (await octo()).rest.issues.create({ owner, repo, title, body });
  return { number: data.number, url: data.html_url };
}

export async function addIssueComment(owner: string, repo: string, issue_number: number, body: string) {
  const { data } = await (await octo()).rest.issues.createComment({ owner, repo, issue_number, body });
  return { id: data.id, url: data.html_url };
}
