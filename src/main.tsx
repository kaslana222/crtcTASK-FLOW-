import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd"
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  clearEditorToken,
  exportMarkdown,
  localPreview,
  owner,
  readTeam,
  repo,
  repositoryReady,
  type ExpenseStatus,
  type Priority,
  type Status,
  type TeamData,
  updateTeam,
  verifyEditor,
} from "./github"
import "./style.css"

const queryClient = new QueryClient()
const tabs = ["总览", "任务看板", "项目目标", "花销记录"] as const
const columns: { id: Status; label: string }[] = [
  { id: "todo", label: "待办" },
  { id: "in_progress", label: "进行中" },
  { id: "completed", label: "已完成" },
]
const expenseLabels: Record<ExpenseStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  paid: "已报销",
}

function message(error: unknown) {
  if (error instanceof Error) {
    if ("status" in error) {
      if (error.status === 401) return "令牌无效或已过期，请重新输入。"
      if (error.status === 403) return "没有仓库写入权限，请检查令牌的 Contents 权限和仓库选择。"
      if (error.status === 404) return `找不到 ${owner}/${repo} 或 data/team.json。`
    }
    return error.message
  }
  return "操作失败，请稍后重试。"
}

function downloadMarkdown(data: TeamData) {
  const url = URL.createObjectURL(new Blob([exportMarkdown(data)], { type: "text/markdown;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `CRTC-中期考核素材-${new Date().toISOString().slice(0, 10)}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("总览")
  const [captain, setCaptain] = useState("")
  const [tokenInput, setTokenInput] = useState("")
  const [error, setError] = useState("")
  const [selectedTask, setSelectedTask] = useState("")
  const cache = useQueryClient()
  const team = useQuery({ queryKey: ["team"], queryFn: readTeam, enabled: repositoryReady(), refetchInterval: 60_000 })
  const write = useMutation({
    scope: { id: "team-write" },
    mutationFn: ({ label, change }: { label: string; change: (data: TeamData) => void }) => updateTeam(label, change),
    onSuccess: (data) => {
      cache.setQueryData(["team"], data)
      cache.invalidateQueries({ queryKey: ["team"] })
      setError("")
    },
    onError: (cause) => setError(message(cause)),
  })
  const data = team.data
  const canEdit = Boolean(captain)
  const submit = (label: string, change: (data: TeamData) => void) => write.mutate({ label, change })

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      setCaptain(await verifyEditor(tokenInput))
      setTokenInput("")
      cache.invalidateQueries({ queryKey: ["team"] })
    } catch (cause) {
      setError(message(cause))
    }
  }

  function onDragEnd(result: DropResult) {
    if (!canEdit || !result.destination || result.source.droppableId === result.destination.droppableId) return
    const status = result.destination.droppableId as Status
    submit("更新任务状态", (latest) => {
      const task = latest.tasks.find((item) => item.id === result.draggableId)
      if (task) task.status = status
    })
  }

  const activeTask = data?.tasks.find((task) => task.id === selectedTask)
  const total = data?.expenses.reduce((sum, item) => sum + item.amount, 0) ?? 0
  const completed = data?.tasks.filter((task) => task.status === "completed").length ?? 0
  const completion = data?.tasks.length ? Math.round((completed / data.tasks.length) * 100) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><div><strong>CRTC 战队进度</strong><small>任务 · 目标 · 花销 · 开发日志</small></div></div>
        <div className="top-actions">
          {data && canEdit && <button className="button ghost" onClick={() => downloadMarkdown(data)}>导出 Markdown</button>}
          {canEdit ? (
            <button className="button ghost" onClick={() => { clearEditorToken(); setCaptain(""); cache.invalidateQueries({ queryKey: ["team"] }) }}>退出编辑 · {captain}</button>
          ) : <span className="read-badge">公开只读</span>}
        </div>
      </header>

      <div className="shell">
        <nav className="nav" aria-label="主导航">
          {tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
          <div className="nav-note">{localPreview ? "本机预览数据" : "公开仓库数据"}<br />{owner && repo ? `${owner}/${repo}` : "未配置仓库"}</div>
        </nav>

        <main className="content">
          <div className="page-heading"><div><p className="eyebrow">TEAM WORKSPACE</p><h1>{tab}</h1><p>队长维护记录，队员打开网页即可查看最新进度。</p></div><button className="button ghost" onClick={() => team.refetch()} disabled={team.isFetching}>刷新数据</button></div>
          {localPreview && <div className="preview-banner">本机预览模式：记录仅保存在这台电脑的当前浏览器，队员看不到。部署到 GitHub Pages 后，正式数据从仓库读取，本机演示数据不会自动上传。</div>}
          {!repositoryReady() && <div className="alert">无法识别 GitHub 仓库。请通过 GitHub Pages 地址打开，或按 README 配置本地开发变量。</div>}
          {team.isLoading && <div className="card">正在读取仓库数据…</div>}
          {team.isError && <div className="alert">读取失败：{message(team.error)}</div>}
          {error && <div className="alert" role="alert">{error}<button onClick={() => setError("")} aria-label="关闭提示">×</button></div>}

          {data && tab === "总览" && <>
            <div className="stats"><div className="stat"><span>任务完成率</span><strong>{completion}%</strong><small>{completed} / {data.tasks.length} 项已完成</small></div><div className="stat"><span>进行中任务</span><strong>{data.tasks.filter((task) => task.status === "in_progress").length}</strong><small>当前正在推进</small></div><div className="stat"><span>累计花销</span><strong>¥{total.toFixed(2)}</strong><small>{data.expenses.length} 笔记录</small></div><div className="stat"><span>项目目标</span><strong>{data.goals.length}</strong><small>平均进度 {data.goals.length ? Math.round(data.goals.reduce((sum, goal) => sum + goal.progress, 0) / data.goals.length) : 0}%</small></div></div>
            <div className="two-col"><section className="card"><h2>近期任务</h2>{data.tasks.slice(-5).reverse().map((task) => <div className="list-row" key={task.id}><span>{task.title}<small>{task.owner || "未分配"}</small></span><span className="pill">{columns.find((col) => col.id === task.status)?.label}</span></div>)}{!data.tasks.length && <p className="empty">暂无任务</p>}</section><section className="card"><h2>里程碑</h2>{data.goals.map((goal) => <div className="goal-mini" key={goal.id}><div><span>{goal.title}</span><strong>{goal.progress}%</strong></div><progress value={goal.progress} max="100" /></div>)}{!data.goals.length && <p className="empty">暂无目标</p>}</section></div>
          </>}

          {data && tab === "任务看板" && <>
            {canEdit && <form className="card form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); const title = String(fields.get("title") || "").trim(); if (!title) return; submit("新增任务", (latest) => latest.tasks.push({ id: crypto.randomUUID(), title, description: String(fields.get("description") || "").trim(), priority: String(fields.get("priority")) as Priority, dueAt: String(fields.get("dueAt") || ""), owner: String(fields.get("owner") || "").trim(), status: "todo", logs: [] })); form.reset() }}>
              <h2>新增任务</h2><input name="title" placeholder="任务标题" required maxLength={120} /><input name="description" placeholder="任务描述" /><input name="owner" placeholder="负责人姓名" /><select name="priority" defaultValue="normal"><option value="low">低优先级</option><option value="normal">普通</option><option value="high">高优先级</option><option value="urgent">紧急</option></select><input name="dueAt" type="date" aria-label="截止日期" /><button className="button primary" disabled={write.isPending}>添加任务</button>
            </form>}
            <DragDropContext onDragEnd={onDragEnd}><div className="board">{columns.map((column) => <Droppable droppableId={column.id} key={column.id}>{(provided) => <section className="board-column" ref={provided.innerRef} {...provided.droppableProps}><h2>{column.label}<span>{data.tasks.filter((task) => task.status === column.id).length}</span></h2>{data.tasks.filter((task) => task.status === column.id).map((task, index) => <Draggable draggableId={task.id} index={index} key={task.id} isDragDisabled={!canEdit}>{(drag) => <article className="task-card" ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps}><button className="task-open" onClick={() => setSelectedTask(task.id)}><strong>{task.title}</strong><p>{task.description || "暂无描述"}</p></button><div className="task-meta"><span>{task.owner || "未分配"}</span><span>{task.priority}</span></div></article>}</Draggable>)}{provided.placeholder}</section>}</Droppable>)}</div></DragDropContext>
          </>}

          {data && tab === "项目目标" && <>
            {canEdit && <form className="card form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); const title = String(fields.get("title") || "").trim(); if (!title) return; submit("新增项目目标", (latest) => latest.goals.push({ id: crypto.randomUUID(), title, description: String(fields.get("description") || "").trim(), progress: 0, dueDate: String(fields.get("dueDate") || "") })); form.reset() }}><h2>新增目标</h2><input name="title" placeholder="目标标题" required maxLength={120} /><input name="description" placeholder="详细说明" /><input name="dueDate" type="date" aria-label="预期完成日期" /><button className="button primary" disabled={write.isPending}>添加目标</button></form>}
            <div className="goal-list">{data.goals.map((goal) => <section className="card goal" key={goal.id}><div className="goal-title"><div><h2>{goal.title}</h2><small>预期完成：{goal.dueDate || "未设置"}</small></div><strong>{goal.progress}%</strong></div><p>{goal.description || "暂无说明"}</p><progress value={goal.progress} max="100" />{canEdit && <div className="goal-actions"><input type="number" min="0" max="100" defaultValue={goal.progress} aria-label={`${goal.title}进度`} id={`progress-${goal.id}`} /><button className="button ghost" disabled={write.isPending} onClick={() => { const input = document.getElementById(`progress-${goal.id}`) as HTMLInputElement; const value = Number(input.value); if (!Number.isFinite(value) || value < 0 || value > 100) return; submit("更新目标进度", (latest) => { const item = latest.goals.find((row) => row.id === goal.id); if (item) item.progress = value }) }}>更新进度</button><button className="button danger" onClick={() => { if (confirm(`删除目标「${goal.title}」？`)) submit("删除项目目标", (latest) => { latest.goals = latest.goals.filter((row) => row.id !== goal.id) }) }}>删除</button></div>}</section>)}{!data.goals.length && <div className="card empty">暂无项目目标</div>}</div>
          </>}

          {data && tab === "花销记录" && <>
            {canEdit && <form className="card form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); const itemName = String(fields.get("itemName") || "").trim(); const amount = Number(fields.get("amount")); if (!itemName || !Number.isFinite(amount) || amount <= 0) return; submit("新增花销记录", (latest) => latest.expenses.push({ id: crypto.randomUUID(), itemName, amount: Math.round(amount * 100) / 100, purchaseDate: String(fields.get("purchaseDate") || ""), buyer: String(fields.get("buyer") || "").trim(), category: String(fields.get("category") || "其他"), status: "pending", note: String(fields.get("note") || "").trim() })); form.reset() }}><h2>录入花销</h2><input name="itemName" placeholder="物品名称" required /><input name="amount" type="number" min="0.01" step="0.01" placeholder="金额（人民币）" required /><input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} aria-label="购买日期" /><input name="buyer" placeholder="购买人" /><select name="category" defaultValue="物料"><option>物料</option><option>交通</option><option>报名</option><option>设备</option><option>其他</option></select><input name="note" placeholder="备注" /><button className="button primary" disabled={write.isPending}>添加记录</button></form>}
            <div className="card table-wrap"><table><thead><tr><th>日期 / 物品</th><th>分类</th><th>购买人</th><th>金额</th><th>报销状态</th><th>备注</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{data.expenses.map((expense) => <tr key={expense.id}><td><strong>{expense.itemName}</strong><small>{expense.purchaseDate}</small></td><td>{expense.category}</td><td>{expense.buyer || "未记录"}</td><td>¥{expense.amount.toFixed(2)}</td><td>{expenseLabels[expense.status]}</td><td>{expense.note || "—"}</td>{canEdit && <td><select value={expense.status} aria-label={`${expense.itemName}报销状态`} onChange={(event) => { const status = event.target.value as ExpenseStatus; submit("更新报销状态", (latest) => { const item = latest.expenses.find((row) => row.id === expense.id); if (item) item.status = status }) }}><option value="pending">待审批</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="paid">已报销</option></select><button className="link-danger" onClick={() => { if (confirm(`删除花销「${expense.itemName}」？`)) submit("删除花销记录", (latest) => { latest.expenses = latest.expenses.filter((row) => row.id !== expense.id) }) }}>删除</button></td>}</tr>)}{!data.expenses.length && <tr><td colSpan={canEdit ? 7 : 6} className="empty">暂无花销记录</td></tr>}</tbody></table></div>
          </>}

          <section className="editor-box"><div><h2>{canEdit ? "队长编辑模式已开启" : "队长编辑入口"}</h2><p>{localPreview ? "本机演示可直接进入编辑；记录只在本机浏览器中。" : canEdit ? "修改会直接保存到 GitHub 仓库。令牌仅保留在当前页面内，关闭或刷新后需要重新输入。" : "队员无需登录。队长输入仅授权此仓库 Contents 读写权限的个人访问令牌。"}</p></div>{!canEdit && <form onSubmit={unlock}>{!localPreview && <input type="password" autoComplete="off" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="GitHub fine-grained token" aria-label="GitHub 个人访问令牌" required />}<button className="button primary">{localPreview ? "进入本机编辑" : "进入编辑"}</button></form>}</section>
        </main>
      </div>

      {activeTask && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelectedTask("") }}><aside className="drawer" role="dialog" aria-modal="true" aria-label="任务详情"><div className="drawer-head"><div><small>任务详情</small><h2>{activeTask.title}</h2></div><button className="button ghost" onClick={() => setSelectedTask("")}>关闭</button></div><p>{activeTask.description || "暂无描述"}</p><div className="task-info">负责人：{activeTask.owner || "未分配"}<br />截止日期：{activeTask.dueAt || "未设置"}</div>{canEdit && <div className="drawer-actions"><select value={activeTask.status} onChange={(event) => { const status = event.target.value as Status; submit("更新任务状态", (latest) => { const item = latest.tasks.find((row) => row.id === activeTask.id); if (item) item.status = status }) }}><option value="todo">待办</option><option value="in_progress">进行中</option><option value="completed">已完成</option></select><button className="button danger" onClick={() => { if (confirm(`删除任务「${activeTask.title}」及其日志？`)) { submit("删除任务", (latest) => { latest.tasks = latest.tasks.filter((row) => row.id !== activeTask.id) }); setSelectedTask("") } }}>删除任务</button></div>}<h3>开发日志</h3>{(activeTask.logs || []).map((log) => <div className="log" key={log.id}><small>{log.recorder} · {new Date(log.recordedAt).toLocaleString("zh-CN")}</small><p>{log.content}</p></div>)}{!activeTask.logs?.length && <p className="empty">暂无日志</p>}{canEdit && <form className="log-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); const content = String(fields.get("content") || "").trim(); if (!content) return; submit("追加任务日志", (latest) => { const task = latest.tasks.find((row) => row.id === activeTask.id); if (task) { task.logs ||= []; task.logs.push({ id: crypto.randomUUID(), content, recorder: captain, recordedAt: new Date().toISOString() }) } }); form.reset() }}><textarea name="content" placeholder="记录进展、遇到的问题和解决方法" required /><button className="button primary" disabled={write.isPending}>追加日志</button></form>}</aside></div>}
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>)
