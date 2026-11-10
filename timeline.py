"""Bounded, durable observations of task changes; never infer completion dates."""
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from datetime import datetime

HISTORY_LIMIT = 200


def valid_review(value):
    try:
        return isinstance(value, str) and datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None
    except ValueError:
        return False


def record_history(root, project_id, data):
    path = Path(root) / 'local' / 'timeline.sqlite'
    path.parent.mkdir(parents=True, exist_ok=True)
    observed = data['generatedAt']
    current, windows = {}, {}
    for lane in data['lanes']:
        for window in lane['windows']:
            if valid_review(window.get('reviewedAt')):
                windows[window['id']] = {'reviewedAt': window['reviewedAt'], 'windowId': window['id'],
                                        'laneId': lane['id'], 'lane': lane['title'][:160],
                                        'window': window['title'][:160], 'title': window['title'][:240],
                                        'sourceKind': window.get('sourceKind', 'project')}
            for task in window['tasks']:
                current[task['id']] = {key: task.get(key) for key in
                                      ('status', 'startsOn', 'dueOn', 'completedAt')}
                current[task['id']].update(title=task['title'][:240], laneId=lane['id'],
                                           windowId=window['id'], lane=lane['title'][:160],
                                           window=window['title'][:160])
    counted = [t for t in current.values() if t['status'] != 'cancelled']
    totals = {'total': len(counted), 'done': sum(t['status'] == 'done' for t in counted)}
    with closing(sqlite3.connect(path, timeout=5)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS timeline_state (project TEXT PRIMARY KEY, started TEXT NOT NULL, tasks TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS timeline_events (id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, payload TEXT NOT NULL)')
        db.execute('CREATE INDEX IF NOT EXISTS timeline_project ON timeline_events(project, id)')
        db.execute('CREATE TABLE IF NOT EXISTS timeline_windows (project TEXT PRIMARY KEY, windows TEXT NOT NULL)')
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT started,tasks FROM timeline_state WHERE project=?', (project_id,)).fetchone()
        started = row[0] if row else observed
        previous = json.loads(row[1]) if row else {}
        prior_windows = db.execute('SELECT windows FROM timeline_windows WHERE project=?', (project_id,)).fetchone()
        previous_windows = json.loads(prior_windows[0]) if prior_windows else {}
        events = []
        if row is None:
            events.append({'kind': 'baseline'})
        else:
            for task_id, task in current.items():
                old = previous.get(task_id)
                kind = 'added' if old is None else 'status' if old['status'] != task['status'] else (
                    'schedule' if any(old.get(k) != task.get(k) for k in ('startsOn', 'dueOn', 'completedAt')) else None)
                if kind:
                    events.append({**task, 'taskId': task_id, 'kind': kind, 'previousStatus': old['status'] if old else None})
            for task_id, old in previous.items():
                if task_id not in current:
                    events.append({**old, 'taskId': task_id, 'kind': 'removed'})
        for window_id, window in windows.items():
            if previous_windows.get(window_id, {}).get('reviewedAt') != window['reviewedAt']:
                events.append({**window, 'kind': 'review'})
        for event in events:
            db.execute('INSERT INTO timeline_events(project,payload) VALUES(?,?)',
                       (project_id, json.dumps({**event, 'observedAt': observed, **totals}, ensure_ascii=False)))
        if current != previous or row is None:
            db.execute('INSERT INTO timeline_state VALUES(?,?,?) ON CONFLICT(project) DO UPDATE SET tasks=excluded.tasks',
                       (project_id, started, json.dumps(current, ensure_ascii=False)))
        if windows != previous_windows or prior_windows is None:
            db.execute('INSERT INTO timeline_windows VALUES(?,?) ON CONFLICT(project) DO UPDATE SET windows=excluded.windows',
                       (project_id, json.dumps(windows, ensure_ascii=False)))
        db.execute('DELETE FROM timeline_events WHERE project=? AND id NOT IN (SELECT id FROM timeline_events WHERE project=? ORDER BY id DESC LIMIT ?)',
                   (project_id, project_id, HISTORY_LIMIT))
        saved = db.execute('SELECT id,payload FROM timeline_events WHERE project=? ORDER BY id DESC LIMIT ?',
                           (project_id, HISTORY_LIMIT)).fetchall()
    return {'startedAt': started, 'limit': HISTORY_LIMIT,
            'events': [{**json.loads(payload), 'id': str(event_id)} for event_id, payload in saved]}
