"""Read-only local project dashboard. Python 3.10+, standard library only."""

from __future__ import annotations

import argparse
import copy
import json
import re
import sqlite3
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from timeline import record_history

ROOT = Path(__file__).resolve().parent
STATES = {"todo", "in_progress", "review", "blocked", "done", "cancelled"}
UPDATE_KEYS = ("summary", "tasks", "evidence", "reviewedAt")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def timestamp(value):
    try:
        date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return date.timestamp() if date.tzinfo else None
    except (TypeError, ValueError):
        return None


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def resolve_path(root, value):
    path = Path(value).expanduser()
    return path if path.is_absolute() else root / path


def normalize_tasks(tasks, window_id):
    if not isinstance(tasks, list):
        raise ValueError("tasks must be a list")
    output = []
    for index, source in enumerate(tasks):
        if not isinstance(source, dict) or not isinstance(source.get("title"), str):
            raise ValueError("every task needs a title")
        task = copy.deepcopy(source)
        state = task.get("status")
        if state is None:
            if not isinstance(task.get("done"), bool):
                raise ValueError("every task needs status or a boolean done")
            state = "done" if task["done"] else "todo"
        if state not in STATES:
            raise ValueError("unsupported task status")
        dependencies = task.get("dependsOn", [])
        if not isinstance(dependencies, list) or any(not isinstance(x, str) for x in dependencies):
            raise ValueError("dependsOn must be a list of task IDs")
        task.update(id=str(task.get("id", f"{window_id}:{index}")), status=state,
                    done=state == "done", dependsOn=dependencies)
        task["priority"] = task.get("priority") if task.get("priority") in {"P0", "P1", "P2", "P3"} else "P2"
        issues = []
        for key in ('startsOn', 'dueOn'):
            value = task.get(key)
            try:
                valid = isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) and datetime.strptime(value, '%Y-%m-%d')
            except ValueError:
                valid = False
            task[key] = value if valid else None
            if value and not valid:
                issues.append('日期格式有误')
        if task['startsOn'] and task['dueOn'] and task['startsOn'] > task['dueOn']:
            issues.append('截止日期早于开始日期')
        completion = task.get('completedAt')
        task['completedAt'] = completion if timestamp(completion) is not None else None
        if completion and not task['completedAt']:
            issues.append('实际完成时间需要有效日期和时区')
        task['scheduleWarning'] = '；'.join(dict.fromkeys(issues))
        output.append(task)
    return output


def read_markdown(path):
    tasks, section = [], ""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("## "):
            section = line[3:].strip()
        match = re.match(r"^- \[([ xX])\] (.+)", line)
        if match and not section.startswith("本轮不做"):
            full = re.sub(r"\*\*|`", "", match.group(2)).strip()
            tasks.append({"title": full.split("。", 1)[0][:160], "done": match.group(1).lower() == "x",
                          "group": section, "evidence": full})
    return tasks, iso(path.stat().st_mtime)


class Dashboard:
    def __init__(self, root=ROOT, config_path=None):
        self.root = Path(root)
        self.config_path = Path(config_path) if config_path else self.root / "config.json"
        self.last_updates = {}

    def config(self):
        path = self.config_path if self.config_path.exists() else self.root / "config.example.json"
        return read_json(path)

    def projects(self):
        config = self.config()
        entries = config.get('projects')
        if entries is None:
            data = read_json(resolve_path(self.root, config.get('dataFile', 'demo/project.json')))
            return [{'id': 'default', 'name': data.get('project', '我的项目')}]
        if not isinstance(entries, list) or not entries:
            raise ValueError('projects must be a nonempty list')
        result = []
        for entry in entries:
            if not isinstance(entry.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', entry['id']):
                raise ValueError('invalid project id')
            result.append({'id': entry['id'], 'name': entry.get('name', entry['id'])})
        if len({entry['id'] for entry in result}) != len(result):
            raise ValueError('duplicate project ids')
        return result

    def activity(self, ids, config, warnings):
        result, health = {}, "disabled"
        if not config.get("enabled", False):
            return result, health
        home = resolve_path(self.root, config.get("home", "~/.codex"))
        databases = [(home / "state_5.sqlite", "metadata"), (home / "thread_history_1.sqlite", "history")]
        successes = 0
        for path, kind in databases:
            try:
                with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1) as db:
                    db.execute("PRAGMA query_only=ON")
                    for tid in set(ids):
                        if kind == "metadata":
                            row = db.execute("SELECT updated_at, archived FROM threads WHERE id=?", (tid,)).fetchone()
                            if row:
                                result.setdefault(tid, {}).update(updatedAt=iso(row[0]), archived=bool(row[1]))
                        else:
                            row = db.execute("SELECT status FROM thread_turns WHERE thread_id=? ORDER BY started_at DESC LIMIT 1", (tid,)).fetchone()
                            if row:
                                result.setdefault(tid, {})["activity"] = {
                                    "inProgress": "进行中", "completed": "空闲", "failed": "出错", "interrupted": "已中断"
                                }.get(row[0], "未知")
                successes += 1
            except (OSError, sqlite3.Error, ValueError):
                warnings.append("Codex 窗口动态暂不可读；任务清单仍可查看。")
        return result, "ok" if successes == 2 else "partial" if successes else "unavailable"

    def build(self, project_id=None):
        config, warnings = self.config(), []
        catalog = self.projects()
        project_id = project_id or config.get('defaultProject') or catalog[0]['id']
        if project_id not in {entry['id'] for entry in catalog}:
            raise LookupError('unknown project')
        if config.get('projects'):
            selected = next(entry for entry in config['projects'] if entry['id'] == project_id)
            config = {**config, **selected}
        data = read_json(resolve_path(self.root, config.get("dataFile", "demo/project.json")))
        lanes = data.get("lanes")
        if not isinstance(lanes, list):
            raise ValueError("project data needs a lanes list")
        windows = [window for lane in lanes for window in lane.get("windows", [])]
        ids = [w["threadId"] for w in windows if w.get("threadId")]
        activities, codex_health = self.activity(ids, config.get("codex", {}), warnings)
        boards = config.get("markdownBoards", {})
        board_count = 0
        update_root = resolve_path(self.root, config.get("updatesDir", "local/updates"))
        for window in windows:
            window_id = str(window.get("id") or window.get("threadId") or "")
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}", window_id) or ".." in window_id:
                raise ValueError("each window needs a safe, unique id")
            window["id"] = window_id
            cache_key = (project_id, window_id)
            window.setdefault("tasks", [])
            window["sourceKind"] = "project"
            update_path = update_root / f"{window_id}.json"
            if update_path.exists():
                try:
                    update = read_json(update_path)
                    if not isinstance(update, dict):
                        raise ValueError("invalid update")
                    if "tasks" in update:
                        normalize_tasks(update["tasks"], window_id)
                    self.last_updates[cache_key] = {k: update[k] for k in UPDATE_KEYS if k in update}
                except (OSError, ValueError, TypeError):
                    warnings.append(f"{window.get('title', window_id)} 的更新文件未完整写入或格式有误，暂用上次完整记录。")
                if cache_key in self.last_updates:
                    window.update(copy.deepcopy(self.last_updates[cache_key]))
                    window["sourceKind"] = "update"
            board = boards.get(window_id)
            if board:
                try:
                    window["tasks"], window["reviewedAt"] = read_markdown(resolve_path(self.root, board))
                    window["sourceKind"] = "markdown"
                    board_count += 1
                except (OSError, UnicodeError):
                    warnings.append(f"{window.get('title', window_id)} 的 Markdown 看板暂不可读，显示项目清单。")
            window.update(activities.get(window.get("threadId"), {}))
            window.setdefault("activity", "未接入")
            window["tasks"] = normalize_tasks(window["tasks"], window_id)
            tracked = [task for task in window["tasks"] if task["status"] != "cancelled"]
            window["doneCount"] = sum(task["done"] for task in tracked)
            window["taskCount"] = len(tracked)
            window["percent"] = round(window["doneCount"] / len(tracked) * 100) if tracked else None
            reviewed, updated = timestamp(window.get("reviewedAt")), timestamp(window.get("updatedAt"))
            window["needsReview"] = reviewed is None or (updated is not None and updated > reviewed)
        window_ids = [window["id"] for window in windows]
        if len(window_ids) != len(set(window_ids)):
            raise ValueError("duplicate window IDs")
        tasks = [task for window in windows for task in window["tasks"]]
        by_id = {task["id"]: task for task in tasks}
        if len(by_id) != len(tasks):
            raise ValueError("duplicate task IDs")
        for task in tasks:
            task["unmetDependencies"] = [
                {"id": dependency, "title": by_id.get(dependency, {}).get("title", dependency), "missing": dependency not in by_id}
                for dependency in task["dependsOn"]
                if dependency not in by_id or by_id[dependency]["status"] != "done"
            ]
            if task["done"] and task["unmetDependencies"]:
                warnings.append(f"“{task['title']}”标为完成，但仍有未完成依赖，需复核。")
        data.update(projectId=project_id, generatedAt=iso(datetime.now(timezone.utc).timestamp()), warnings=list(dict.fromkeys(warnings)),
                    sourceHealth={"codex": codex_health, "markdownBoards": board_count},
                    refreshSeconds=max(2, min(300, int(config.get("refreshSeconds", 5)))),
                    timezone=config.get("timezone", "Asia/Shanghai"), schemaVersion=2)
        try:
            data['history'] = record_history(self.root, project_id, data)
        except (OSError, sqlite3.Error, ValueError):
            data['history'] = {'events': [], 'limit': 200, 'error': True}
            data['warnings'].append('时间轴历史暂时不可用；当前任务状态仍可查看。')
        return data


def handler_for(dashboard):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path in ("/api/state", "/api/projects"):
                try:
                    query = parse_qs(urlsplit(self.path).query)
                    result = {'projects': dashboard.projects()} if path == '/api/projects' else dashboard.build(query.get('project', [None])[0])
                    body = json.dumps(result, ensure_ascii=False).encode("utf-8")
                    self.respond(200, "application/json; charset=utf-8", body)
                except LookupError:
                    self.respond(404, "application/json; charset=utf-8", json.dumps({'error':'项目不存在，请切换到已登记的项目。'}, ensure_ascii=False).encode('utf-8'))
                except (ValueError, OSError, TypeError, KeyError) as exc:
                    print(f"Data read error: {type(exc).__name__}", flush=True)
                    self.respond(503, "application/json; charset=utf-8", json.dumps({"error": "项目数据格式有误或暂时不可读。请检查配置及 JSON 文件。"}, ensure_ascii=False).encode("utf-8"))
                return
            files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css"), "/favicon.svg": ("favicon.svg", "image/svg+xml")}
            files['/timeline.js'] = ('timeline.js', 'text/javascript')
            if path not in files:
                self.respond(404, "text/plain", b"Not found")
                return
            name, mime = files[path]
            self.respond(200, mime + "; charset=utf-8", (dashboard.root / name).read_bytes())

        def respond(self, code, mime, body):
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            pass
    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--open", action="store_true", help="open the local dashboard in the default browser")
    args = parser.parse_args()
    dashboard = Dashboard(config_path=args.config)
    dashboard.build()
    url = f"http://127.0.0.1:{args.port}/"
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(dashboard)) as server:
        print(url, flush=True)
        if args.open:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
