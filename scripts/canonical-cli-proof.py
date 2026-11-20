"""Local CLI migration-history proof using actual repository SQL; no hosted targets.
Pass the absolute path of an already-installed Supabase CLI. Requires Docker.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).with_name('canonical-bootstrap.py'))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', required=True, type=Path)
    args = parser.parse_args()
    cli = str(args.cli.resolve(strict=True))
    manifest = bootstrap.source_steps()
    output = bootstrap.DEFAULT_OUTPUT / ('cli-' + uuid.uuid4().hex[:10])
    output.mkdir(parents=True)
    baseline = bootstrap.export(manifest, output / 'complete')
    prefix = dict(manifest, steps=manifest['steps'][:-1], baseline_version='20261118213001',
                  forward=[manifest['steps'][-1]['file']])
    bootstrap.export(prefix, output / 'forward')
    duplicate = output/'duplicate/supabase/migrations'
    duplicate.mkdir(parents=True)
    pair = [s for s in manifest['steps'] if s['file'].startswith('20260823170000_')]
    for step in pair:
        (duplicate/step['file']).write_text(bootstrap.read_sql(bootstrap.ROOT/'supabase/migrations'/step['file']), encoding='utf-8', newline='\n')
    (duplicate.parent/'config.toml').write_text('project_id = "pharmacystock-duplicate-local"\n')
    container = 'pharmacystock-canonical-cli-' + uuid.uuid4().hex[:10]
    network = container + '-local'
    result = {}
    bootstrap.command('docker','image','inspect',bootstrap.IMAGE)
    bootstrap.command('docker','network','create',network)
    created = False
    try:
        bootstrap.command('docker','run','--pull=never','--detach','--name',container,'--network',network,
                          '-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data',
                          '-e','POSTGRES_HOST_AUTH_METHOD=trust',bootstrap.IMAGE)
        created = True
        for _ in range(80):
            if bootstrap.command('docker','exec',container,'pg_isready','-U','postgres',check=False).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError('Local CLI database unavailable')
        inspect = json.loads(bootstrap.command('docker','inspect',container).stdout)[0]
        port = inspect['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
        def sql(text, db='postgres'):
            return bootstrap.command('docker','exec','-i',container,'psql','-q','-tA','-X','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1',sql=text).stdout.decode('utf-8')
        platform = bootstrap.read_sql(bootstrap.BOOTSTRAP/'platform-fixture.sql')
        sql(platform)
        for database in ('forward_path','duplicate_path'):
            sql(f'create database {database} template template0;')
            sql(platform.replace('create role anon nologin;','').replace('create role authenticated nologin;',''), database)
        # The CLI receives an explicit loopback URL and an independent config without a project link.
        env = {key:value for key,value in os.environ.items() if not key.startswith(('SUPABASE_','PG'))}
        def migrate(folder, db, label, expect_success=True):
            call = subprocess.run([cli,'migration','up','--db-url',f'postgres://postgres@127.0.0.1:{port}/{db}?sslmode=disable',
                                   '--workdir',str(output/folder)],env=env,capture_output=True)
            (output/(label+'.log')).write_bytes(call.stdout+call.stderr)
            if (call.returncode == 0) != expect_success:
                raise RuntimeError((call.stdout+call.stderr).decode('utf-8',errors='replace'))
            return call
        result['cli_version'] = subprocess.check_output([cli,'--version'],env=env).decode().strip()
        migrate('complete','postgres','baseline')
        result['baseline_history'] = sql('select json_agg(row_to_json(t)) from (select version,name from supabase_migrations.schema_migrations order by version)t;')
        migrate('complete','postgres','baseline-noop')
        result['baseline_history_unchanged'] = result['baseline_history'] == sql('select json_agg(row_to_json(t)) from (select version,name from supabase_migrations.schema_migrations order by version)t;')
        migrate('forward','forward_path','real-forward')
        result['forward_history'] = sql('select json_agg(row_to_json(t)) from (select version,name from supabase_migrations.schema_migrations order by version)t;', 'forward_path')
        result['forward_schema_equivalent'] = bootstrap.schema_dump(container) == bootstrap.schema_dump(container,'forward_path')
        # Apply the genuine prerequisites, then let the CLI execute both genuine colliding files.
        first_index = next(i for i,s in enumerate(manifest['steps']) if s['file']==pair[0]['file'])
        sql('begin;\n'+bootstrap.baseline_sql(manifest['steps'][:first_index])+'\ncommit;', 'duplicate_path')
        call = migrate('duplicate','duplicate_path','duplicate-version',False)
        result['duplicate_rejected_by_cli'] = b'schema_migrations_pkey' in (call.stderr+call.stdout) and b'23505' in (call.stderr+call.stdout)
        result['duplicate_history'] = sql('select json_agg(row_to_json(t)) from (select version,name from supabase_migrations.schema_migrations order by version)t;', 'duplicate_path')
        # Also prove a version AFTER the complete 53-source baseline. This local-only
        # metadata probe is created by the CLI and really executed; no history repair.
        # The separate 52-source + actual final migration above proves substantive DDL.
        created_migration = subprocess.run([cli,'migration','new','canonical_forward_probe',
                                           '--workdir',str(output/'complete')],env=env,capture_output=True)
        (output/'forward-create.log').write_bytes(created_migration.stdout+created_migration.stderr)
        if created_migration.returncode:
            raise RuntimeError('CLI could not create the isolated forward probe')
        probes = list((output/'complete/supabase/migrations').glob('*_canonical_forward_probe.sql'))
        if len(probes) != 1 or probes[0].name[:14] <= manifest['baseline_version']:
            raise RuntimeError('Forward probe must follow the complete canonical baseline')
        probes[0].write_text("-- Disposable CLI proof only; never copy to product migrations.\n"
                             "comment on schema app_private is 'Canonical forward path verified';\n",
                             encoding='utf-8',newline='\n')
        migrate('complete','postgres','full-baseline-forward')
        result['full_baseline_forward_history'] = sql('select json_agg(row_to_json(t)) from (select version,name from supabase_migrations.schema_migrations order by version)t;')
        result['full_baseline_forward_version'] = probes[0].name[:14]
        expected_history = [dict(version=manifest['baseline_version'],name='canonical_bootstrap'),
                            dict(version=probes[0].name[:14],name='canonical_forward_probe')]
        result['full_baseline_forward_executed'] = (
            json.loads(result['full_baseline_forward_history']) == expected_history and
            sql("select obj_description('app_private'::regnamespace,'pg_namespace');").strip() == 'Canonical forward path verified')
        migrate('complete','postgres','full-baseline-forward-noop')
        result['full_baseline_forward_noop'] = result['full_baseline_forward_history'] == sql('select json_agg(row_to_json(t)) from (select version,name from supabase_migrations.schema_migrations order by version)t;')
        (output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
        if not all(result[k] for k in ('baseline_history_unchanged','forward_schema_equivalent','duplicate_rejected_by_cli',
                                       'full_baseline_forward_executed','full_baseline_forward_noop')):
            raise RuntimeError('CLI history proof did not meet all expectations')
        print(json.dumps(result,indent=2))
        print('Evidence: '+str(output))
    finally:
        if created:
            bootstrap.command('docker','rm','--force',container)
        bootstrap.command('docker','network','rm',network)


if __name__ == '__main__':
    main()
