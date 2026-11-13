#!/usr/bin/env python3
"""Pure configuration rendering for the VPS installer. Secrets are read on stdin."""
import argparse, ipaddress, json, os, re, secrets, sys
from pathlib import Path

def host_kind(host):
    if not host or len(host)>253 or any(c in host for c in '/\\\r\n:;{}$ '):
        raise ValueError('Укажите IPv4 или домен без https:// и без порта.')
    try:
        value=ipaddress.ip_address(host)
    except ValueError:
        if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?',host):
            raise ValueError('Неверный домен. Используйте имя вида suflyor.example.ru.')
        return 'domain'
    if value.version!=4 or not value.is_global:
        raise ValueError('Нужен публичный IPv4-адрес.')
    return 'ipv4'

def nginx_config(host,tls=False):
    host_kind(host)
    challenge='''    location ^~ /.well-known/acme-challenge/ {
        root /var/www/suflyor-acme;
        default_type text/plain;
        try_files $uri =404;
    }
'''
    http=f'''server {{
    listen 80;
    server_name {host};
{challenge}'''
    if not tls:
        return http+'    location / { return 503 "Suflyor: HTTPS setup in progress\\n"; }\n}\n'
    return http+'''    location / { return 301 https://$host$request_uri; }
}
'''+f'''server {{
    listen 443 ssl;
    server_name {host};
    ssl_certificate /etc/letsencrypt/live/suflyor/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/suflyor/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 2m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;
    gzip_min_length 1024;
    location / {{
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 240s;
        proxy_send_timeout 240s;
    }}
}}
'''

def write_environment(path,data):
    key=str(data.get('key','')).strip();password=str(data.get('password',''))
    if not key or not password or any(c in key+password for c in '\r\n\x00'):
        raise ValueError('Ключ и пароль должны быть непустыми, без переносов строк.')
    values={'DEEPSEEK_API_KEY':key,'DEEPSEEK_MODEL':'deepseek-flash','APP_PASSWORD':password,
            'APP_SESSION_SECRET':secrets.token_hex(32),'NODE_ENV':'production','HOST':'127.0.0.1','PORT':'3000'}
    path=Path(path)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as file:
        for key,value in values.items():
            file.write(key+'='+json.dumps(value,ensure_ascii=False)+'\n')
    os.chmod(path,0o600)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['kind','nginx','environment','check-host-unused'])
    parser.add_argument('--host');parser.add_argument('--tls',action='store_true');parser.add_argument('--path')
    args=parser.parse_args()
    if args.command=='kind':print(host_kind(args.host))
    elif args.command=='nginx':print(nginx_config(args.host,args.tls),end='')
    elif args.command=='environment':
        key,password=sys.stdin.read().split('\x00',1);write_environment(args.path,{'key':key,'password':password})
    elif args.command=='check-host-unused':
        host_kind(args.host);config=re.sub(r'#.*','',sys.stdin.read())
        if any(args.host in names.split() for names in re.findall(r'\bserver_name\s+([^;]+);',config)):
            raise ValueError('Этот адрес уже настроен в другом сайте Nginx. Не перезаписываю его конфигурацию.')

if __name__=='__main__':
    try:main()
    except (ValueError,OSError) as error:print(str(error),file=sys.stderr);sys.exit(1)
