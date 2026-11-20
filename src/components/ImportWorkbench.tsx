import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from '../i18n/useTranslation';
import { Button, FormField, TextField } from './ui';
import { ImportColumnMapping } from './ImportColumnMapping';
import { importColumns, importPostingErrorKey, MAX_IMPORT_CHARACTERS, type ImportType } from '../domain/importPreview';
import { csvByteLength, parseCsvDocument, type CsvIssue } from '../domain/csv';
import { formatImportValue, importCounts, importErrorCsv, importTemplate, mappedPreview, recognizeColumns, type ColumnMapping } from '../domain/importMapping';
import { commitImportJob, inspectImport, loadImportJobs, loadImportRows, stageImport, type ImportAttempt, type ImportJob, type ImportRow } from '../services/coreCompletion';
import { createNamespacedStorage } from '../offline/storage';
import { errorPresentationKey } from '../utils/errorPresentation';
import { exportCsv } from '../utils/exportCsv';
import { formatInstantDateTime } from '../utils/dateFormatting';
import { formatImportStatus, formatImportType } from '../domain/operationsPresentation';
const importTypes: ImportType[] = ['PRODUCTS', 'SUPPLIERS', 'CUSTOMERS', 'OPENING_STOCK'];
const PAGE_SIZE = 25;
const attempts = createNamespacedStorage('pharmacystock:import-attempts:v1');
type Props = { organizationId: string; userId: string; branchId?: string|null; branchName?: string; currencyCode?: string; timezone?: string; allowed: boolean };
/** Branch/account changes remount the preview; retained attempts keep their original scope. */
export function ImportWorkbench(props: Props) {
  return <ScopedImportWorkbench key={`${props.userId}:${props.organizationId}:${props.branchId ?? ''}`} {...props} />;
}
function ScopedImportWorkbench({ organizationId, userId, branchId, branchName, currencyCode, timezone, allowed }: Props) {
  const { t, i18n } = useTranslation();
  const attemptKey = `${userId}:${organizationId}:${branchId ?? ''}`;
  const [pending, setPending] = useState<ImportAttempt|null>(null);
  const [restoring,setRestoring]=useState(true); const [loadingJobs,setLoadingJobs]=useState(allowed);
  const [type, setType] = useState<ImportType>('PRODUCTS');
  const [text, setText] = useState(''); const [fileName, setFileName] = useState('import.csv');
  const [mapping, setMapping] = useState<ColumnMapping>({}); const [mapped, setMapped] = useState(false);
  const [reviewed, setReviewed] = useState(false); const [checked, setChecked] = useState(false);
  const [serverIssues, setServerIssues] = useState<CsvIssue[]>([]); const [warnings, setWarnings] = useState<CsvIssue[]>([]);
  const [page, setPage] = useState(0); const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [results, setResults] = useState<ImportRow[]>([]); const [resultPage, setResultPage] = useState(0);
  const [resultJob, setResultJob] = useState<ImportJob|null>(null); const [stagedId, setStagedId] = useState<string|null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string|null>(null); const [message, setMessage] = useState<string|null>(null);
  const generation = useRef(0); const inFlight = useRef(false);
  const parsed = useMemo(() => mapped && text.length <= MAX_IMPORT_CHARACTERS ? parseCsvDocument(text) : null, [text, mapped]);
  const preview = useMemo(() => reviewed ? mappedPreview(text, type, mapping) : null, [text, type, reviewed, mapping]);
  const rows = useMemo(() => preview?.rows.map(row => ({ ...row, errors: [...row.errors, ...serverIssues.filter(issue => issue.rowNumber === row.rowNumber)] })) ?? [], [preview, serverIssues]);
  const counts = importCounts(rows, warnings);
  const forBranch = useCallback((items: ImportJob[]) => items.filter(job => job.import_type !== 'OPENING_STOCK' || job.branch_id === branchId), [branchId]);
  const refresh = useCallback(async () => { const current = generation.current; setLoadingJobs(true); try { const next = await loadImportJobs(organizationId); if (current === generation.current) setJobs(forBranch(next)); } finally { if (current===generation.current) setLoadingJobs(false); } }, [organizationId, forBranch]);
  useEffect(() => { const scope = generation; return () => { scope.current++; }; }, []);
  useEffect(() => { const current=generation.current; const timer=setTimeout(() => { if (allowed) void refresh().catch(cause => { if (current===generation.current) setError(t(errorPresentationKey(cause))); }); },0); return () => clearTimeout(timer); }, [allowed, refresh, t]);
  useEffect(() => {
    // Restore the external durable draft after hydration, with a cancellable scope.
    const timer=setTimeout(() => { try {
      const raw=attempts.get(attemptKey); const saved=raw ? JSON.parse(raw) as ImportAttempt : null;
      if (saved && (!saved.attemptId || saved.organizationId!==organizationId || (saved.branchId ?? null)!==(branchId ?? null) || !Array.isArray(saved.rows))) throw new Error('IMPORT_RECOVERY_UNAVAILABLE');
      setPending(saved); setRestoring(false);
    } catch { setError(t('imports.recoveryUnavailable')); } },0);
    return () => clearTimeout(timer);
  }, [attemptKey,organizationId,branchId,t]);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return; inFlight.current = true;
    const current = generation.current; setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (cause) { if (current === generation.current) setError(t((cause as {message?:string})?.message?.includes('IMPORT_LIMIT') ? 'imports.errors.IMPORT_LIMIT' : 'imports.requestFailed') + ' ' + t(errorPresentationKey(cause))); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  const resetValidation = () => { setReviewed(false); setChecked(false); setServerIssues([]); setWarnings([]); setPage(0); };
  const makeAttempt = (next: NonNullable<typeof preview>): ImportAttempt => ({ attemptId: randomUUID(), organizationId, branchId, type, fileName, rows: next.rows.map(row => row.data), rowNumbers: next.rows.map(row => row.rowNumber), originalRows: next.originals.map(row => row.data) });
  const review = () => run(async () => {
    const next = mappedPreview(text, type, mapping); const current = generation.current;
    setReviewed(true); setChecked(false); setServerIssues([]); setWarnings([]);
    if (!next.valid || !allowed) return;
    const inspected = await inspectImport(makeAttempt(next));
    if (generation.current !== current) return;
    setServerIssues(inspected.flatMap(row => row.issues.filter(issue => issue.severity !== 'warning').map(issue => ({ ...issue, rowNumber: row.rowNumber }))));
    setWarnings(inspected.flatMap(row => row.issues.filter(issue => issue.severity === 'warning').map(issue => ({ ...issue, rowNumber: row.rowNumber })))); setChecked(true);
  });
  const stage = () => run(async () => {
    if (!allowed || (!pending && (!preview?.valid || !checked || serverIssues.length))) return;
    const current = generation.current; const attempt = pending ?? makeAttempt(preview!);
    // Persist before dispatch; editing/reset stays locked until this exact command recovers.
    if (!pending) { attempts.set(attemptKey, JSON.stringify(attempt)); setPending(attempt); }
    const id = await stageImport(attempt);
    attempts.remove(attemptKey);
    if (current !== generation.current) return;
    setPending(null); setStagedId(id); setMessage(t('imports.staged')); await refresh();
  });
  const showResult = async (job: ImportJob, nextPage = 0) => {
    const current = generation.current; const next = await loadImportRows(organizationId, job.id, nextPage);
    if (current !== generation.current) return; setResults(next); setResultJob(job); setResultPage(nextPage);
  };
  const commit = (id: string) => run(async () => {
    if (!allowed) return; const current = generation.current;
    await commitImportJob(id); const next = await loadImportJobs(organizationId);
    if (current !== generation.current) return;
    setJobs(forBranch(next)); const job = next.find(item => item.id === id);
    if (job) { await showResult(job); setMessage(t(job.status === 'COMPLETED' ? 'imports.completed' : 'imports.partial', { success: job.valid_rows, failed: job.invalid_rows })); }
  });
  const localErrors = () => {
    if (!preview) return;
    const errorRows = preview.originals.map(row => ({ ...row, errors: [...preview.errors, ...serverIssues].filter(issue => issue.rowNumber === row.rowNumber) }));
    return exportCsv('import-errors.csv', importErrorCsv(preview.originals.length ? Object.keys(preview.originals[0]!.data) : [], errorRows, code => t(`imports.errors.${code}`)));
  };
  const savedErrors = async (job: ImportJob) => {
    const all: ImportRow[] = [];
    for (let index=0; index<20; index++) { const next = await loadImportRows(organizationId, job.id, index); all.push(...next); if (next.length < PAGE_SIZE) break; }
    if (all.length !== job.total_rows) throw new Error('IMPORT_RESULTS_INCOMPLETE');
    const records = all.map(row => ({ rowNumber: row.row_number, data: row.raw_data as Record<string,string>, errors: row.status === 'INVALID' && Array.isArray(row.errors) ? row.errors.map(issue => typeof issue === 'string' ? { rowNumber: row.row_number, code: issue } : { ...issue, rowNumber: row.row_number }) as CsvIssue[] : [] }));
    const headers = Array.from(new Set(records.flatMap(row => Object.keys(row.data))));
    await exportCsv('import-result-errors.csv', importErrorCsv(headers, records, code => t(code.startsWith('IMPORT_') ? `imports.errors.${code}` : importPostingErrorKey(code))));
  };
  const acceptText = (content: string, name = fileName) => { setText(content); setFileName(name); setMapped(false); setMapping({}); resetValidation(); setError(null); };
  const selectFile = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const current = generation.current; const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.csv,text/csv';
    picker.onchange = () => { const file = picker.files?.[0]; if (!file) return;
      if (!/\.csv$/i.test(file.name)) { setError(t('imports.csvOnly')); return; }
      if (file.size > MAX_IMPORT_CHARACTERS) { setError(t('imports.errors.IMPORT_TOO_LARGE')); return; }
      void file.text().then(content => { if (current === generation.current) acceptText(content, file.name); }).catch(() => { if (current === generation.current) setError(t('imports.fileReadError')); });
    }; picker.click();
  };
  const editing = allowed && !restoring && !busy && !stagedId && !pending;
  const issueLabel = (issue: CsvIssue) => `${t('imports.row', { row: issue.rowNumber })}${issue.field ? ' · '+t(`imports.fields.${issue.field}`, { defaultValue: issue.field }) : ''}: ${t(`imports.errors.${issue.code}`)}${issue.value ? ' · '+issue.value.slice(0,120) : ''}`;
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.title}>{t('sprint7.admin.imports')}</Text><Text>{t('imports.help')}</Text>
    <Text>{t('imports.branchBound', { branch: branchName ?? branchId ?? t('imports.noBranch') })}</Text>
    <Text>{t('imports.createOnly')}</Text>
    {!allowed ? <Text accessibilityRole="alert">{t('production.settings.onlineOnly')}</Text> : null}
    {pending ? <View style={s.preview}><Text accessibilityRole="alert">{t('imports.recoverHelp', { file: pending.fileName })}</Text><Button disabled={!allowed || busy} label={t('imports.recover')} onPress={() => void stage()} /></View> : null}
    <View style={s.actions}>{importTypes.map(item => <Button key={item} variant={type === item ? 'primary' : 'secondary'} disabled={!editing} label={formatImportType(item,t)} onPress={() => { setType(item); setMapping({}); setMapped(false); resetValidation(); }} />)}</View>
    <Text>{t('imports.headers')}</Text><Text selectable style={s.meta}>{importColumns[type].join(',')}</Text>
    <Text>{t(type === 'OPENING_STOCK' ? 'imports.openingHelp' : 'imports.requiredName')}</Text>
    <Button variant="secondary" disabled={busy} label={t('imports.template')} onPress={() => void run(() => exportCsv(`template-${type.toLowerCase()}.csv`, importTemplate(type)))} />
    {Platform.OS === 'web' ? <Button variant="secondary" disabled={!editing} label={t('imports.chooseFile')} onPress={selectFile} /> : null}
    <FormField label={t('sprint7.admin.fileName')}><TextField accessibilityLabel={t('sprint7.admin.fileName')} editable={editing} maxLength={200} value={fileName} onChangeText={value => { setFileName(value); resetValidation(); }} /></FormField>
    <FormField label={t('sprint7.admin.csv')} hint={t('imports.pasteHelp')}><TextField accessibilityLabel={t('sprint7.admin.csv')} editable={editing} multiline style={s.csv} value={text} onChangeText={value => acceptText(value)} /></FormField>
    <View style={s.actions}><Button disabled={!editing || !text.trim()} label={t('imports.map')} onPress={() => {
      if (csvByteLength(text) > MAX_IMPORT_CHARACTERS) { setError(t('imports.errors.IMPORT_TOO_LARGE')); return; }
      const source = parseCsvDocument(text); if (source.headers.length>30) { setError(t('imports.errors.IMPORT_COLUMNS')); return; }
      setMapping(recognizeColumns(source.headers,type)); setMapped(true); resetValidation();
    }} /><Button variant="secondary" disabled={busy || !!pending} label={t('imports.reset')} onPress={() => { acceptText(''); setStagedId(null); setMessage(null); setResultJob(null); }} /></View>
    {parsed ? <ImportColumnMapping headers={parsed.headers} mapping={mapping} type={type} disabled={!editing} onChange={next => { setMapping(next); resetValidation(); }} /> : null}
    {mapped ? <Button disabled={!editing} label={t('imports.preview')} onPress={() => void review()} /> : null}
    {preview ? <View style={s.preview}><Text style={s.title}>{t('imports.previewCounts',counts)}</Text>
      <Text>{t(preview.valid && !serverIssues.length ? 'imports.valid' : 'imports.invalid')}</Text>
      <Text>{t('imports.postingPlan',{ count: counts.valid })}</Text>
      {[...preview.errors.filter(issue => issue.rowNumber===1), ...rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).flatMap(row=>row.errors)].map((issue,index) => <Text accessibilityRole="alert" style={s.error} key={index}>{issueLabel(issue)}</Text>)}
      {warnings.filter(issue=>rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).some(row=>row.rowNumber===issue.rowNumber)).map((issue,index)=><Text key={index}>{issueLabel(issue)}</Text>)}
      {rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(row => <View style={s.row} key={row.rowNumber}><Text style={s.bold}>{t('imports.row',{ row: row.rowNumber })}</Text><Text selectable>{preview.headers.map(header=>`${t(`imports.fields.${header}`)}: ${formatImportValue(header,row.data[header] ?? '',i18n.language,currencyCode)}`).join(' · ')}</Text></View>)}
      <View style={s.actions}><Button variant="secondary" label={t('imports.previous')} disabled={page===0} onPress={()=>setPage(value=>value-1)} /><Button variant="secondary" label={t('imports.next')} disabled={(page+1)*PAGE_SIZE>=rows.length} onPress={()=>setPage(value=>value+1)} /><Button variant="secondary" disabled={busy || !rows.some(row=>row.errors.length)} label={t('imports.exportErrors')} onPress={()=>void run(async()=>{await localErrors();})} /></View>
      <Button disabled={!editing || !preview.valid || !checked || !!serverIssues.length} loading={busy} label={t('imports.stage')} onPress={()=>void stage()} />
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}{message ? <Text accessibilityRole="alert" style={s.bold}>{message}</Text> : null}
    <Text style={s.title}>{t('sprint7.admin.jobs')}</Text><Text>{t('imports.historyLimit')}</Text>
    <Button variant="secondary" disabled={!allowed || busy} label={t('imports.refresh')} onPress={()=>void run(refresh)} />
    {loadingJobs ? <Text>{t('imports.loadingHistory')}</Text> : null}
    {!jobs.length && !loadingJobs ? <Text style={s.meta}>{t('sprint7.admin.noJobs')}</Text> : jobs.map(job=><View style={s.row} key={job.id}>
      <Text style={s.bold}>{job.file_name ?? formatImportType(job.import_type,t)}</Text>
      <Text>{formatImportType(job.import_type,t)} · {formatImportStatus(job.status,t)} · {t('imports.jobCounts',{success:job.valid_rows,failed:job.invalid_rows,total:job.total_rows})}</Text>
      <Text>{formatInstantDateTime(job.created_at,i18n.language,timezone)} · {t('imports.actor')}: {job.created_by ?? t('imports.unknownActor')}{job.branch_id ? ` · ${t('imports.fields.branch_id')}: ${job.branch_id===branchId ? branchName ?? job.branch_id : job.branch_id}` : ''}</Text>
      <View style={s.actions}><Button variant="secondary" disabled={!allowed || busy} label={t('imports.results')} onPress={()=>void run(()=>showResult(job))} />{job.status==='READY' ? <Button disabled={!allowed || busy} label={t('imports.commit')} onPress={()=>void commit(job.id)} /> : null}</View>
    </View>)}
    {resultJob ? <View style={s.preview}><Text style={s.title}>{t('imports.results')} · {resultJob.file_name}</Text><Text>{formatImportStatus(resultJob.status,t)}</Text>
      <Button variant="secondary" label={t('imports.exportErrors')} disabled={!allowed || busy || !resultJob.invalid_rows || resultJob.total_rows>500} onPress={()=>void run(()=>savedErrors(resultJob))} />
      {results.map(row=><View key={row.id} style={s.row}><Text>{t('imports.row',{row:row.row_number})} · {t(row.status==='IMPORTED'?'imports.rowImported':row.status==='INVALID'?'imports.rowFailed':'imports.rowReady')}</Text><Text selectable>{Object.entries((row.raw_data ?? {}) as Record<string,string>).map(([key,value])=>`${key}: ${value}`).join(' · ')}</Text>{Array.isArray(row.errors) ? row.errors.map((issue,index)=><Text key={index} style={s.error}>{typeof issue==='string' ? t(importPostingErrorKey(issue)) : issueLabel({...issue,rowNumber:row.row_number})}</Text>) : null}</View>)}
      <View style={s.actions}><Button variant="secondary" label={t('imports.previous')} disabled={!allowed || busy || resultPage===0} onPress={()=>void run(()=>showResult(resultJob,resultPage-1))} /><Button variant="secondary" label={t('imports.next')} disabled={!allowed || busy || (resultPage+1)*PAGE_SIZE>=resultJob.total_rows} onPress={()=>void run(()=>showResult(resultJob,resultPage+1))} /></View>
    </View> : null}
  </View>;
}
const s=StyleSheet.create({card:{padding:18,borderRadius:16,backgroundColor:'#fff',gap:12},title:{fontSize:18,fontWeight:'700',color:'#102A5C'},actions:{flexDirection:'row',flexWrap:'wrap',gap:8},csv:{minHeight:140},preview:{gap:10,borderTopWidth:1,borderColor:'#D0D5DD',paddingTop:12},row:{gap:6,borderBottomWidth:1,borderColor:'#EAECF0',paddingVertical:10},error:{color:'#B42318'},meta:{color:'#667085'},bold:{fontWeight:'700'}});
