"""Prove a canonical fresh database locally; never reads credentials or accepts a server URL.
Requires Python 3.10+ and the already-present postgres:17-alpine Docker image.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / 'supabase/bootstrap'
DEFAULT_OUTPUT = ROOT / '.expo/canonical-bootstrap-evidence'
IMAGE = 'postgres@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7'


def command(*args, sql=None, check=True):
    result = subprocess.run(args, input=sql.encode('utf-8') if sql is not None else None,
                            capture_output=True)
    if check and result.returncode:
        raise RuntimeError((result.stderr + result.stdout).decode('utf-8', errors='replace'))
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_sql(path):
    return path.read_text(encoding='utf-8-sig')


def source_steps():
    manifest = json.loads((BOOTSTRAP / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['format'] != 1:
        raise ValueError('Unsupported manifest format')
    steps = manifest['steps']
    seen = set()
    for step in steps:
        name = step['file']
        if not re.fullmatch(r'[0-9]{14}_[a-z0-9_]+\.sql', name) or name in seen:
            raise ValueError('Invalid or repeated historical filename')
        if not set(step['requires']).issubset(seen):
            raise ValueError('Manifest prerequisite order is invalid: ' + name)
        if digest(read_sql(ROOT / 'supabase/migrations' / name).encode('utf-8')) != step['sha256']:
            raise ValueError('Historical source changed: ' + name)
        seen.add(name)
    version = manifest['baseline_version']
    if not re.fullmatch(r'[0-9]{14}', version) or version <= max(x[:14] for x in seen):
        raise ValueError('Baseline version must follow every covered historical source')
    actual = {p.name for p in (ROOT / 'supabase/migrations').glob('*.sql')}
    forward = sorted(actual - seen)
    versions = set()
    for name in forward:
        if not re.fullmatch(r'[0-9]{14}_[a-z0-9_]+\.sql', name) or name[:14] <= version or name[:14] in versions:
            raise ValueError('New migration must have a unique version after the canonical baseline: ' + name)
        versions.add(name[:14])
    manifest['forward'] = forward
    return manifest


EMPTY_GUARD = """do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind in ('r','p','v','m','S','f'))
    or exists(select 1 from pg_namespace where nspname='app_private') then
   raise exception 'CANONICAL_BOOTSTRAP_REQUIRES_EMPTY_APPLICATION_SCHEMA';
 end if;
 if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null then
   raise exception 'SUPABASE_PLATFORM_CONTRACT_REQUIRED';
 end if;
end $$;
"""


def baseline_sql(steps):
    # Every complete source appears once, without editing or excerpting statements.
    parts = ['-- Generated canonical fresh-only baseline. Never apply to an existing pharmacy database.\n', EMPTY_GUARD]
    for step in steps:
        parts.append('\n-- Complete source: ' + step['file'] + '; sha256 UTF-8/LF: ' + step['sha256'] + '\n')
        parts.append(read_sql(ROOT / 'supabase/migrations' / step['file']) + '\n')
    return ''.join(parts)


def export(manifest, destination):
    destination = destination.resolve()
    if destination == ROOT or ROOT not in destination.parents:
        raise ValueError('Export must stay inside this worktree')
    destination.mkdir(parents=True, exist_ok=False)
    migrations = destination / 'supabase/migrations'
    migrations.mkdir(parents=True)
    name = manifest['baseline_version'] + '_canonical_bootstrap.sql'
    (migrations / name).write_text(baseline_sql(manifest['steps']), encoding='utf-8', newline='\n')
    for filename in manifest['forward']:
        (migrations / filename).write_text(read_sql(ROOT/'supabase/migrations'/filename), encoding='utf-8', newline='\n')
    (destination / 'supabase/config.toml').write_text('project_id = "pharmacystock-canonical-local"\n', encoding='utf-8')
    return migrations / name


def schema_dump(container, database='postgres'):
    output = command('docker','exec',container,'pg_dump','-U','postgres','-d',database,
                     '--schema-only','--no-owner','--schema=public','--schema=app_private').stdout
    # PostgreSQL 17 random psql restriction tokens are transport guards, not schema.
    output = re.sub(rb'^\\(?:un)?restrict .*\r?\n', b'', output, flags=re.M)
    return output


def run_proof(manifest, output, run_number, chronological=False):
    container = 'pharmacystock-canonical-' + uuid.uuid4().hex[:10]
    logs = output / f'run-{run_number}'
    logs.mkdir(parents=True, exist_ok=False)
    command('docker','image','inspect',IMAGE)  # Fail offline instead of implicitly downloading.
    command('docker','run','--pull=never','--detach','--name',container,'--network','none',
            '--label','pharmacystock.purpose=canonical-bootstrap','--tmpfs','/var/lib/postgresql/data',
            '-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE)

    def sql(value, database='postgres', check=True):
        return command('docker','exec','-i',container,'psql','-q','-tA','-X','-U','postgres',
                       '-d',database,'-v','ON_ERROR_STOP=1',sql=value,check=check)

    summary = {'run': run_number, 'image': IMAGE, 'bootstrap': False, 'suites': []}
    try:
        inspection = json.loads(command('docker','inspect',container).stdout)[0]
        summary['image_id'] = inspection['Image']
        if inspection['HostConfig']['NetworkMode'] != 'none' or inspection['HostConfig']['PortBindings']:
            raise RuntimeError('Proof database must be network-disabled with no published ports')
        for _ in range(80):
            if command('docker','exec',container,'pg_isready','-U','postgres',check=False).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError('Disposable database did not become ready')
        platform = read_sql(BOOTSTRAP / 'platform-fixture.sql')
        sql(platform)
        sql(EMPTY_GUARD)
        steps = manifest['steps']
        if chronological:
            steps = sorted(steps, key=lambda step: step['file'])
        for index, step in enumerate(steps, 1):
            print(f"Run {run_number}: {index:02d}/{len(steps)} {step['file']}", flush=True)
            result = sql('begin;\n' + read_sql(ROOT/'supabase/migrations'/step['file']) + '\ncommit;', check=False)
            (logs / (step['file']+'.log')).write_bytes(result.stdout + result.stderr)
            if result.returncode:
                raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
        for filename in manifest['forward']:
            sql('begin;\n' + read_sql(ROOT/'supabase/migrations'/filename) + '\ncommit;')
        summary['bootstrap'] = True
        schema = schema_dump(container)
        (logs/'schema.sql').write_bytes(schema)
        summary['schema_sha256'] = digest(schema)
        result = sql(read_sql(BOOTSTRAP/'schema-assertions.sql'))
        (logs/'schema-assertions.log').write_bytes(result.stdout + result.stderr)
        summary['schema_assertions'] = True
        metrics = sql("""select json_build_object(
         'tables',(select count(*) from pg_tables where schemaname='public'),
         'views',(select count(*) from pg_views where schemaname='public'),
         'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private')),
         'indexes',(select count(*) from pg_indexes where schemaname='public'),
         'constraints',(select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
         'triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal));"""
        ).stdout
        summary['schema_objects'] = json.loads(metrics)
        # Independent empty database: prove the generated single-file CLI baseline is equivalent.
        sql('create database generated template template0;')
        sql(platform.replace('create role anon nologin;','').replace('create role authenticated nologin;',''), 'generated')
        sql('begin;\n' + baseline_sql(manifest['steps']) + '\ncommit;', 'generated')
        for filename in manifest['forward']:
            sql('begin;\n' + read_sql(ROOT/'supabase/migrations'/filename) + '\ncommit;', 'generated')
        summary['generated_baseline_equivalent'] = schema_dump(container,'generated') == schema
        if not summary['generated_baseline_equivalent']:
            raise RuntimeError('Generated baseline schema differs from full-file replay')
        # Real existing final migration serves as the forward-migration proof, no dummy SQL.
        sql('create database future_path template template0;')
        sql(platform.replace('create role anon nologin;','').replace('create role authenticated nologin;',''), 'future_path')
        sql('begin;\n' + baseline_sql(manifest['steps'][:-1]) + '\ncommit;', 'future_path')
        sql('begin;\n' + read_sql(ROOT/'supabase/migrations'/manifest['steps'][-1]['file']) + '\ncommit;', 'future_path')
        for filename in manifest['forward']:
            sql('begin;\n' + read_sql(ROOT/'supabase/migrations'/filename) + '\ncommit;', 'future_path')
        summary['real_forward_migration_equivalent'] = schema_dump(container,'future_path') == schema
        if not summary['real_forward_migration_equivalent']:
            raise RuntimeError('Real forward migration did not produce the canonical final schema')
        result = sql(read_sql(BOOTSTRAP/'application-smoke.sql'), check=False)
        (logs/'application-smoke.log').write_bytes(result.stdout + result.stderr)
        summary['application_smoke'] = result.returncode == 0
        print(('PASS' if result.returncode == 0 else 'FAIL') + ' application smoke', flush=True)
        # Clone the fully bootstrapped schema before fixtures; every suite gets its own database.
        sql('create database canonical_template template postgres;')
        needs_data = {'business_settings_functional.sql','customer_workflow_functional.sql',
                      'notifications_functional.sql','daily_operations_acceptance.sql'}
        needs_helper = {'expiry_completion_functional.sql','transfer_completion_functional.sql'}
        for index, path in enumerate(sorted((ROOT/'supabase/tests').glob('*.sql'))):
            database = f'suite_{index}'
            sql(f'create database {database} template canonical_template;')
            if path.name in needs_data:
                sql(read_sql(BOOTSTRAP/'suite-fixture.sql'), database)
            if path.name in needs_helper:
                sql(read_sql(BOOTSTRAP/'assertion-helper.sql'), database)
            result = sql(read_sql(path), database, check=False)
            (logs/(path.name+'.test.log')).write_bytes(result.stdout + result.stderr)
            summary['suites'].append({'suite':path.name,'passed':result.returncode == 0,
                                     'error':result.stderr.decode('utf-8',errors='replace') if result.returncode else None})
            print(('PASS ' if result.returncode == 0 else 'FAIL ') + path.name, flush=True)
        summary['passed'] = sum(s['passed'] for s in summary['suites'])
        summary['failed'] = len(summary['suites']) - summary['passed']
        return summary
    finally:
        (logs/'results.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
        command('docker','rm','--force',container)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, help='Generate a NEW separate CLI workspace inside this worktree; no connections')
    parser.add_argument('--validate', action='store_true', help='Verify source hashes and dependency order only')
    parser.add_argument('--chronological', action='store_true', help='Reproduce historical failure, locally only')
    parser.add_argument('--runs', type=int, choices=(1,2), default=2)
    parser.add_argument('--output', type=Path, help='New evidence directory inside this worktree')
    args = parser.parse_args()
    manifest = source_steps()
    if args.validate:
        print(f"VALID: {len(manifest['steps'])} historical files; {len(manifest['forward'])} forward files")
        return 0
    if args.export:
        print(export(manifest, args.export))
        return 0
    output = (args.output or (DEFAULT_OUTPUT / ('proof-' + uuid.uuid4().hex[:10]))).resolve()
    if ROOT not in output.parents:
        raise ValueError('Evidence must stay in this worktree')
    output.mkdir(parents=True, exist_ok=False)
    results = [run_proof(manifest, output, number, args.chronological) for number in range(1,args.runs+1)]
    stable = len({r['schema_sha256'] for r in results}) == 1
    report = {'deterministic_schema':stable, 'runs':results}
    (output/'results.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print('Evidence: ' + str(output))
    print('Schema deterministic: ' + str(stable))
    print('Suites: ' + '; '.join(f"{r['passed']} passed, {r['failed']} failed" for r in results))
    return 0 if stable and all(r['failed']==0 and r['application_smoke'] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
