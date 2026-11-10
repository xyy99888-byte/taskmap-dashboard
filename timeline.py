"""Bounded, durable observations of task changes; never infer completion dates."""
import json
import sqlite3
from contextlib import closing
from pathlib import Path

HISTORY_LIMIT = 200


def record_history(root, project_id, data):
    path = Path(root) / 'local' / 'timeline.sqlite'
    path.parent.mkdir(parents=True, exist_ok=True)
    observed = data['generatedAt']
    current = {}
    for lane in data['lanes']:
        for window in lane['windows']:
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
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT started,tasks FROM timeline_state WHERE project=?', (project_id,)).fetchone()
        started = row[0] if row else observed
        previous = json.loads(row[1]) if row else {}
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
        for event in events:
            db.execute('INSERT INTO timeline_events(project,payload) VALUES(?,?)',
                       (project_id, json.dumps({**event, 'observedAt': observed, **totals}, ensure_ascii=False)))
        if current != previous or row is None:
            db.execute('INSERT INTO timeline_state VALUES(?,?,?) ON CONFLICT(project) DO UPDATE SET tasks=excluded.tasks',
                       (project_id, started, json.dumps(current, ensure_ascii=False)))
        db.execute('DELETE FROM timeline_events WHERE project=? AND id NOT IN (SELECT id FROM timeline_events WHERE project=? ORDER BY id DESC LIMIT ?)',
                   (project_id, project_id, HISTORY_LIMIT))
        saved = db.execute('SELECT id,payload FROM timeline_events WHERE project=? ORDER BY id DESC LIMIT ?',
                           (project_id, HISTORY_LIMIT)).fetchall()
    return {'startedAt': started, 'limit': HISTORY_LIMIT,
            'events': [{**json.loads(payload), 'id': str(event_id)} for event_id, payload in saved]}
