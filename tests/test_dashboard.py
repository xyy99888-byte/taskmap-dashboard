import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Dashboard, handler_for, read_json

ROOT = Path(__file__).resolve().parents[1]


class DashboardTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / 'local' / 'test-temp'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temp.name)
        self.assertTrue(self.root.resolve().is_relative_to(parent.resolve()))
        self.data = read_json(ROOT / 'demo' / 'project.json')
        self.config = {'dataFile': 'project.json', 'updatesDir': 'updates', 'codex': {'enabled': False}}
        self.write('project.json', self.data)
        self.write('config.json', self.config)
        self.dashboard = Dashboard(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, value):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def test_demo_works_without_codex(self):
        data = self.dashboard.build()
        self.assertEqual(data['sourceHealth']['codex'], 'disabled')
        self.assertEqual(data['lanes'][0]['windows'][0]['percent'], 50)

    def test_missing_codex_does_not_hide_tasks_or_report_idle(self):
        self.config['codex'] = {'enabled': True, 'home': str(self.root / 'missing-codex')}
        self.write('config.json', self.config)
        data = self.dashboard.build()
        self.assertEqual(data['sourceHealth']['codex'], 'unavailable')
        self.assertEqual(data['lanes'][0]['windows'][0]['activity'], '未接入')
        self.assertTrue(data['warnings'])

    def test_project_selection_and_cached_updates_are_isolated(self):
        self.config['projects'] = [
            {'id': 'one', 'name': 'One', 'updatesDir': 'one-updates'},
            {'id': 'two', 'name': 'Two', 'updatesDir': 'two-updates'}]
        self.config['defaultProject'] = 'two'
        self.write('config.json', self.config)
        self.write('one-updates/design.json', {'summary': 'private to one'})
        self.assertEqual(self.dashboard.build('one')['lanes'][0]['windows'][0]['summary'], 'private to one')
        self.write('two-updates/design.json', {})
        (self.root / 'two-updates/design.json').write_text('{', encoding='utf-8')
        second = self.dashboard.build()
        self.assertEqual(second['projectId'], 'two')
        self.assertNotEqual(second['lanes'][0]['windows'][0].get('summary'), 'private to one')
        self.assertEqual(len(self.dashboard.projects()), 2)
        with self.assertRaises(LookupError):
            self.dashboard.build('unknown')

    def test_partial_update_preserves_last_valid_record(self):
        self.write('updates/design.json', {'summary': 'verified update', 'tasks': [{'title': 'only task', 'done': True}]})
        self.assertEqual(self.dashboard.build()['lanes'][0]['windows'][0]['percent'], 100)
        (self.root / 'updates' / 'design.json').write_text('{"tasks":', encoding='utf-8')
        data = self.dashboard.build()
        self.assertEqual(data['lanes'][0]['windows'][0]['summary'], 'verified update')
        self.assertEqual(data['lanes'][0]['windows'][0]['percent'], 100)
        self.assertTrue(data['warnings'])

    def test_cancelled_excluded_and_delivery_stage_preserved(self):
        self.write('updates/design.json', {'tasks': [
            {'id': 'one', 'title': 'local work', 'status': 'done', 'stage': 'local'},
            {'id': 'two', 'title': 'cancelled', 'status': 'cancelled'}]})
        window = self.dashboard.build()['lanes'][0]['windows'][0]
        self.assertEqual(window['taskCount'], 1)
        self.assertEqual(window['percent'], 100)
        self.assertEqual(window['tasks'][0]['stage'], 'local')

    def test_cross_window_dependencies_and_missing_ids_visible(self):
        self.data['lanes'][2]['windows'][0]['tasks'][0]['dependsOn'].append('unknown-task')
        self.write('project.json', self.data)
        task = self.dashboard.build()['lanes'][2]['windows'][0]['tasks'][0]
        self.assertEqual(len(task['unmetDependencies']), 3)
        self.assertTrue(task['unmetDependencies'][-1]['missing'])

    def test_timestamp_compared_as_instants(self):
        self.dashboard.activity = lambda *args: ({'thread-1': {'updatedAt': '2026-11-01T02:00:00Z'}}, 'ok')
        window = self.data['lanes'][0]['windows'][0]
        window.update(threadId='thread-1', reviewedAt='2026-11-01T11:00:00+08:00')
        self.write('project.json', self.data)
        self.assertFalse(self.dashboard.build()['lanes'][0]['windows'][0]['needsReview'])

    def test_missing_markdown_preserves_registered_tasks(self):
        self.config['markdownBoards'] = {'design': 'missing.md'}
        self.write('config.json', self.config)
        data = self.dashboard.build()
        self.assertEqual(data['lanes'][0]['windows'][0]['taskCount'], 2)
        self.assertTrue(data['warnings'])

    def test_private_files_not_served_over_http(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.dashboard))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            with urllib.request.urlopen(base + '/api/state') as response:
                self.assertEqual(response.status, 200)
            for path in ['/config.json', '/project.json', '/../../config.json']:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + path)
                self.assertEqual(error.exception.code, 404)
                error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
