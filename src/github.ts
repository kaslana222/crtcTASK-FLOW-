import { Octokit } from "@octokit/core"
import seedData from "../data/team.json"

export type Status = "todo" | "in_progress" | "completed"
export type Priority = "low" | "normal" | "high" | "urgent"
export type ExpenseStatus = "pending" | "approved" | "rejected" | "paid"

export type TaskLog = {
  id: string
  content: string
  recorder: string
  recordedAt: string
}
export type Task = {
  id: string
  title: string
  description: string
  priority: Priority
  dueAt: string
  owner: string
  status: Status
  logs: TaskLog[]
}
export type Goal = {
  id: string
  title: string
  description: string
  progress: number
  dueDate: string
}
export type Expense = {
  id: string
  itemName: string
  amount: number
  purchaseDate: string
  buyer: string
  category: string
  status: ExpenseStatus
  note: string
}
export type TeamData = { tasks: Task[]; goals: Goal[]; expenses: Expense[] }

const hostOwner = location.hostname.endsWith(".github.io")
  ? location.hostname.slice(0, -".github.io".length)
  : ""
const pathRepo = location.pathname.split("/").filter(Boolean)[0] || ""
export const owner = import.meta.env.VITE_GITHUB_OWNER || hostOwner
export const repo = import.meta.env.VITE_GITHUB_REPO || pathRepo
export const localPreview = ["localhost", "127.0.0.1"].includes(location.hostname)
const branch = import.meta.env.VITE_GITHUB_BRANCH || "main"
const dataPath = "data/team.json"
const localDataKey = "crtc-local-preview"
const anonymous = new Octokit()
const rawFiles = new Octokit({ baseUrl: "https://raw.githubusercontent.com" })
let editorToken = ""

export function repositoryReady() {
  return localPreview || Boolean(owner && repo)
}

function localData(): TeamData {
  const saved = localStorage.getItem(localDataKey)
  return saved ? JSON.parse(saved) as TeamData : structuredClone(seedData) as TeamData
}

export function setEditorToken(token: string) {
  editorToken = token.trim()
}

export function clearEditorToken() {
  editorToken = ""
}

function client() {
  return editorToken ? new Octokit({ auth: editorToken }) : anonymous
}

function decodeBase64(value: string) {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, "")), (char) =>
    char.charCodeAt(0),
  )
  return new TextDecoder().decode(bytes)
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function loadFile() {
  if (!repositoryReady()) throw new Error("未识别仓库地址，请检查部署地址或本地配置。")
  const response = await client().request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path: dataPath,
    ref: branch,
  })
  const file = response.data as { content?: string; sha?: string; type?: string }
  if (file.type !== "file" || !file.content || !file.sha) {
    throw new Error(`仓库中缺少 ${dataPath} 文件。`)
  }
  const data = JSON.parse(decodeBase64(file.content)) as TeamData
  if (!Array.isArray(data.tasks) || !Array.isArray(data.goals) || !Array.isArray(data.expenses)) {
    throw new Error(`${dataPath} 的数据结构不正确。`)
  }
  return { data, sha: file.sha }
}

export async function readTeam() {
  if (localPreview) return localData()
  if (editorToken) return (await loadFile()).data
  if (!repositoryReady()) throw new Error("未识别仓库地址，请检查部署地址或本地配置。")
  const response = await rawFiles.request("GET /{owner}/{repo}/{branch}/{path}", {
    owner,
    repo,
    branch,
    path: dataPath,
    refresh: Date.now(),
  })
  const data = (typeof response.data === "string" ? JSON.parse(response.data) : response.data) as TeamData
  if (!Array.isArray(data.tasks) || !Array.isArray(data.goals) || !Array.isArray(data.expenses)) {
    throw new Error(`${dataPath} 的数据结构不正确。`)
  }
  return data
}

export async function verifyEditor(token: string) {
  if (localPreview) return "本地演示"
  const input = token.trim()
  if (!input) throw new Error("请先输入 GitHub 个人访问令牌。")
  const signed = new Octokit({ auth: input })
  const user = await signed.request("GET /user")
  setEditorToken(input)
  return user.data.login
}

export async function updateTeam(
  message: string,
  change: (data: TeamData) => void,
) {
  if (localPreview) {
    const data = localData()
    change(data)
    localStorage.setItem(localDataKey, JSON.stringify(data))
    return data
  }
  if (!editorToken) throw new Error("请先以队长身份进入编辑模式。")
  const { data, sha } = await loadFile()
  change(data)
  try {
    await client().request("PUT /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path: dataPath,
      message,
      content: encodeBase64(`${JSON.stringify(data, null, 2)}\n`),
      sha,
      branch,
    })
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 409) {
      throw new Error("保存冲突：仓库数据刚被更新，请刷新页面后重试。")
    }
    throw error
  }
  return data
}

export function exportMarkdown(data: TeamData) {
  const lines = [
    "# CRTC 战队中期考核素材",
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "> 以下为平台原始记录，提交正式文档前请补充技术选型、难点分析和证据截图。",
    "",
    "## 项目目标",
    "",
  ]
  for (const goal of data.goals) {
    lines.push(`### ${goal.title}`, "", `- 进度：${goal.progress}%`, `- 预期完成：${goal.dueDate || "未设置"}`, "", goal.description, "")
  }
  lines.push("## 任务与开发日志", "")
  for (const task of data.tasks) {
    lines.push(`### ${task.title}`, "", `- 负责人：${task.owner || "未分配"}`, `- 状态：${({ todo: "待办", in_progress: "进行中", completed: "已完成" } as const)[task.status]}`, `- 优先级：${task.priority}`, `- 截止时间：${task.dueAt || "未设置"}`, "", task.description || "无描述", "")
    for (const log of task.logs || []) lines.push(`- ${log.recordedAt} · ${log.recorder}：${log.content.replace(/\n/g, " ")}`)
    lines.push("")
  }
  lines.push("## 花销记录", "", "| 日期 | 物品 | 分类 | 购买人 | 金额（元） | 报销状态 | 备注 |", "| --- | --- | --- | --- | ---: | --- | --- |")
  for (const expense of data.expenses) {
    const safe = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ")
    lines.push(`| ${safe(expense.purchaseDate)} | ${safe(expense.itemName)} | ${safe(expense.category)} | ${safe(expense.buyer)} | ${expense.amount.toFixed(2)} | ${safe(expense.status)} | ${safe(expense.note)} |`)
  }
  return `${lines.join("\n")}\n`
}
