import copy
import json
import unittest
from pathlib import Path
from server import Dashboard
from sync_client import prepare_snapshot, origin

ROOT = Path(__file__).resolve().parents[1]


class SyncTests(unittest.TestCase):
    def test_private_identifiers_and_paths_not_uploaded(self):
        data = Dashboard(ROOT).build()
        window = data['lanes'][0]['windows'][0]
        window.update(threadId='secret-thread-id', id='secret-window-id', evidence=r'本地 C:\Users\Person\private\file.py 测试通过 Bearer abc123TOKEN')
        result = prepare_snapshot(data)
        encoded = json.dumps(result, ensure_ascii=False)
        for value in ('secret-thread-id', 'secret-window-id', 'C:', 'Person', 'abc123TOKEN'):
            self.assertNotIn(value, encoded)
        self.assertIn('测试通过', encoded)

    def test_stable_public_task_ids_and_dependencies(self):
        data = Dashboard(ROOT).build()
        first = prepare_snapshot(data)
        task = first['lanes'][0]['windows'][0]['tasks'][0]
        dependent = first['lanes'][0]['windows'][0]['tasks'][1]
        self.assertEqual(dependent['dependsOn'], [task['id']])
        data['lanes'].reverse()
        second = prepare_snapshot(data)
        self.assertEqual(second['lanes'][-1]['windows'][0]['tasks'][0]['id'], task['id'])

    def test_only_https_or_explicit_loopback_endpoints(self):
        self.assertEqual(origin('https://example.test/'), 'https://example.test')
        self.assertEqual(origin('http://127.0.0.1:9999'), 'http://127.0.0.1:9999')
        for value in ('http://example.test', 'https://name:secret@example.test', 'https://example.test/api', 'file:///tmp/data'):
            with self.assertRaises(ValueError):
                origin(value)


if __name__ == '__main__':
    unittest.main()
