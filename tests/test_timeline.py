import tempfile
import unittest
from pathlib import Path
from server import normalize_tasks
from sync_client import prepare_snapshot
from timeline import record_history


def data():
    return {'generatedAt': '2026-11-10T02:00:00Z', 'lanes': [
        {'id': 'lane-private', 'title': '模块', 'color': '#123456', 'windows': [
            {'id': 'window-private', 'title': '窗口', 'tasks': [
                {'id': 'task-private', 'title': '事项', 'status': 'done'}]}]}]}


class TimelineTests(unittest.TestCase):
    def test_review_dates_persist_without_becoming_completion_dates(self):
        with tempfile.TemporaryDirectory() as root:
            d = data(); window = d['lanes'][0]['windows'][0]
            window['reviewedAt'] = '2026-11-08T09:00:00Z'
            first = record_history(root, 'one', d)
            review = first['events'][0]
            self.assertEqual(review['kind'], 'review')
            self.assertEqual(review['reviewedAt'], window['reviewedAt'])
            self.assertEqual(review['observedAt'], d['generatedAt'])
            self.assertNotIn('completedAt', review)
            self.assertEqual(record_history(root, 'one', d), first)
            window['reviewedAt'] = '2026-11-09T09:00:00Z'
            later = record_history(root, 'one', d)
            self.assertEqual(len([e for e in later['events'] if e['kind'] == 'review']), 2)
            d['history'] = later
            uploaded = prepare_snapshot(d)['history']['events'][0]
            self.assertEqual(uploaded['reviewedAt'], window['reviewedAt'])
            self.assertNotEqual(uploaded['windowId'], window['id'])

    def test_concurrent_pollers_record_one_baseline(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as root:
            with ThreadPoolExecutor(max_workers=3) as pool:
                list(pool.map(lambda _: record_history(root, 'one', data()), range(6)))
            self.assertEqual(len(record_history(root, 'one', data())['events']), 1)

    def test_baseline_restart_dedup_and_project_isolation(self):
        with tempfile.TemporaryDirectory() as root:
            d = data()
            first = record_history(root, 'one', d)
            self.assertEqual([e['kind'] for e in first['events']], ['baseline'])
            self.assertEqual(first['events'][0]['done'], 1)
            self.assertEqual(record_history(Path(root), 'one', d), first)
            d['lanes'][0]['windows'][0]['tasks'][0]['status'] = 'todo'
            d['generatedAt'] = '2026-11-11T03:00:00Z'
            changed = record_history(root, 'one', d)
            self.assertEqual(changed['startedAt'], first['startedAt'])
            self.assertEqual(changed['events'][0]['previousStatus'], 'done')
            self.assertEqual(changed['events'][0]['done'], 0)
            other = record_history(root, 'two', d)
            self.assertEqual(len(other['events']), 1)
            self.assertEqual(other['events'][0]['kind'], 'baseline')

    def test_schedule_removal_and_retention(self):
        with tempfile.TemporaryDirectory() as root:
            d = data(); record_history(root, 'one', d)
            task = d['lanes'][0]['windows'][0]['tasks'][0]
            task['dueOn'] = '2026-11-15'
            self.assertEqual(record_history(root, 'one', d)['events'][0]['kind'], 'schedule')
            for i in range(205):
                task['status'] = 'done' if i % 2 else 'todo'
                result = record_history(root, 'one', d)
            self.assertEqual(len(result['events']), 200)
            d['lanes'][0]['windows'][0]['tasks'] = []
            result = record_history(root, 'one', d)
            self.assertEqual(result['events'][0]['kind'], 'removed')
            self.assertEqual(result['events'][0]['total'], 0)

    def test_dates_and_history_upload_privacy(self):
        tasks = normalize_tasks([{'title': '测试', 'status': 'todo', 'startsOn': '2026-02-30', 'completedAt': '2026-11-01T10:00:00'}], 'w')
        self.assertIsNone(tasks[0]['startsOn'])
        self.assertIsNone(tasks[0]['completedAt'])
        self.assertTrue(tasks[0]['scheduleWarning'])
        reverse = normalize_tasks([{'title': '倒置', 'status': 'todo', 'startsOn': '2026-11-12', 'dueOn': '2026-11-10'}], 'w')[0]
        self.assertTrue(reverse['scheduleWarning'])
        with tempfile.TemporaryDirectory() as root:
            d = data(); record_history(root, 'one', d)
            task = d['lanes'][0]['windows'][0]['tasks'][0]
            task.update(status='todo', startsOn='2026-11-10', dueOn='2026-11-15', completedAt=None)
            d['history'] = record_history(root, 'one', d)
            result = prepare_snapshot(d)
            event = result['history']['events'][0]
            uploaded = result['lanes'][0]['windows'][0]['tasks'][0]
            self.assertEqual(event['taskId'], uploaded['id'])
            self.assertEqual(uploaded['startsOn'], '2026-11-10')
            self.assertNotIn('private', str(result))
