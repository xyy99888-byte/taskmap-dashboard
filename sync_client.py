"""Pair and upload a local dashboard to its owner's Cloudflare project."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from server import Dashboard

ROOT = Path(__file__).resolve().parent
DEFAULT_CREDENTIALS = ROOT / 'local' / 'sync-credentials.json'


def origin(value):
    url = urllib.parse.urlsplit(value)
    if url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('请填写网站根地址，不要包含账号、路径或参数。')
    if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost')):
        raise ValueError('公网同步必须使用 HTTPS。')
    if not url.netloc:
        raise ValueError('网站地址不正确。')
    return urllib.parse.urlunsplit((url.scheme, url.netloc, '', '', ''))


def post(base, path, value, token=None):
    data = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if len(data) > 512 * 1024:
        raise ValueError('同步数据超过 512 KB，请缩减任务依据或拆分项目。')
    headers = {'Content-Type': 'application/json', 'User-Agent': 'ProjectProgressSync/0.1'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(base + path, data=data, headers=headers, method='POST')
    # Do not forward a scoped bearer credential to another host on redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read()).get('error', f'HTTP {error.code}')
        except (ValueError, UnicodeError):
            message = f'HTTP {error.code}'
        finally:
            error.close()
        raise RuntimeError(f'{error.code}: {message}') from None


def save_credentials(path, credentials):
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        json.dump(credentials, output, ensure_ascii=False, indent=2)
    temporary.replace(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def clean_text(value):
    if not isinstance(value, str):
        return value
    value = re.sub(r'(?i)(?:[A-Z]:[\\/]|file:///)[^\s`"<>；，。]+', '[本机路径]', value)
    value = re.sub(r'https?://(?:127\.0\.0\.1|localhost)(?::\d+)?[^\s`"<>]*', '[本机预览]', value)
    value = re.sub(r'(?i)\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]+', 'Bearer [已隐藏]', value)
    value = re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s,;]+', r'\1[已隐藏]', value)
    return value


def prepare_snapshot(data):
    """Allowlisted progress fields only; never transmit thread IDs or DB paths."""
    output = {key: clean_text(data.get(key)) for key in ('project', 'scope', 'generatedAt', 'timezone')}
    output['sourceHealth'] = data.get('sourceHealth', {})
    output['warnings'] = [clean_text(x) for x in data.get('warnings', [])]
    output['lanes'] = []
    mapping = {}
    def public_id(kind, value):
        return kind + '-' + hashlib.sha256(str(value).encode('utf-8')).hexdigest()[:24]
    # Stable opaque IDs preserve links without transmitting local thread IDs.
    for li, lane in enumerate(data['lanes']):
        for wi, window in enumerate(lane['windows']):
            for ti, task in enumerate(window['tasks']):
                mapping[task['id']] = public_id('t', task['id'])
    for li, lane in enumerate(data['lanes']):
        target = {'id': public_id('m', lane['id']), 'title': clean_text(lane['title']), 'color': lane.get('color'), 'windows': []}
        for wi, window in enumerate(lane['windows']):
            fields = ('title', 'summary', 'evidence', 'owner', 'reviewedAt', 'updatedAt', 'activity', 'sourceKind')
            item = {key: clean_text(window.get(key)) for key in fields}
            item.update(id=public_id('w', window['id']), tasks=[])
            for task in window['tasks']:
                fields = ('title', 'status', 'priority', 'stage', 'acceptance', 'evidence', 'blocker', 'nextAction', 'group', 'milestone', 'startsOn', 'dueOn', 'completedAt', 'scheduleWarning')
                record = {key: clean_text(task.get(key)) for key in fields}
                record.update(id=mapping[task['id']], dependsOn=[mapping.get(key, public_id('missing', key)) for key in task.get('dependsOn', [])])
                item['tasks'].append(record)
            target['windows'].append(item)
        output['lanes'].append(target)
    history = data.get('history', {})
    output['history'] = {'startedAt': history.get('startedAt'), 'limit': 200, 'error': bool(history.get('error')), 'events': []}
    for event in history.get('events', [])[:200]:
        item = {key: clean_text(event.get(key)) for key in ('id', 'kind', 'observedAt', 'reviewedAt', 'sourceKind', 'title', 'lane', 'window', 'status', 'previousStatus', 'total', 'done', 'startsOn', 'dueOn', 'completedAt')}
        for key, kind in (('taskId', 't'), ('laneId', 'm'), ('windowId', 'w')):
            item[key] = public_id(kind, event[key]) if event.get(key) else None
        output['history']['events'].append(item)
    return output


def connect(args):
    site, endpoint = origin(args.site), origin(args.endpoint)
    if args.credentials.exists():
        raise ValueError('此路径已有连接凭证。请先在网站撤销旧设备，再备份该文件或指定新的 --credentials 路径。')
    info = post(endpoint, '/v1/pair/start', {'deviceName': args.name or socket.gethostname()})
    url = site + '/?pair=' + urllib.parse.quote(info['code'])
    print('请登录网站并确认连接：' + url, flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    deadline = time.monotonic() + info['expiresIn']
    while time.monotonic() < deadline:
        result = post(endpoint, '/v1/pair/status', {'code': info['code'], 'pollSecret': info['pollSecret']})
        if result['status'] == 'approved':
            save_credentials(args.credentials, {'site': site, 'endpoint': endpoint, **{key: result[key] for key in ('token', 'deviceId', 'projectId', 'expiresAt')}})
            print('配对成功。运行 run 命令开始同步；凭证仅保存在本机。', flush=True)
            return
        time.sleep(5)
    raise RuntimeError('配对过期，请重新运行连接命令。')


def run(args):
    dashboard = Dashboard(root=args.root.resolve(), config_path=args.config)
    if args.preview:
        print(json.dumps(prepare_snapshot(dashboard.build(args.project)), ensure_ascii=False, indent=2))
        return
    credentials = json.loads(args.credentials.read_text(encoding='utf-8-sig'))
    endpoint = origin(credentials['endpoint'])
    delay = max(5, args.interval)
    last_sequence = 0
    while True:
        try:
            payload = prepare_snapshot(dashboard.build(args.project))
            if args.preview:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
                return
            last_sequence = max(last_sequence + 1, int(time.time() * 1000))
            result = post(endpoint, '/v1/snapshot', {'sequence': last_sequence, 'snapshot': payload}, credentials['token'])
            print('已同步：' + result['receivedAt'], flush=True)
            delay = max(5, args.interval)
            if args.once:
                return
        except (OSError, ValueError, RuntimeError) as error:
            print('同步暂未成功：' + str(error), file=sys.stderr, flush=True)
            if str(error).startswith(('401:', '403:', '409:')) or args.once or args.preview:
                raise SystemExit(1)
            delay = min(60, delay * 2)
        time.sleep(delay)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path, default=DEFAULT_CREDENTIALS)
    sub = parser.add_subparsers(dest='command', required=True)
    pair = sub.add_parser('connect')
    pair.add_argument('--site', required=True)
    pair.add_argument('--endpoint', required=True)
    pair.add_argument('--name')
    pair.add_argument('--no-browser', action='store_true')
    upload = sub.add_parser('run')
    upload.add_argument('--root', type=Path, default=ROOT)
    upload.add_argument('--config', type=Path)
    upload.add_argument('--project', help='Local project ID from config.projects')
    upload.add_argument('--interval', type=int, default=10)
    upload.add_argument('--once', action='store_true')
    upload.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    try:
        connect(args) if args.command == 'connect' else run(args)
    except KeyboardInterrupt:
        print('同步已停止。')
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
