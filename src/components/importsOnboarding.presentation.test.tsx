import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { ImportWorkbench } from './ImportWorkbench';
import { ImportColumnMapping } from './ImportColumnMapping';
import en from '../i18n/imports.en.json'; import fr from '../i18n/imports.fr.json';
const translator=createInstance();void translator.init({initAsync:false,lng:'en',resources:{en:{translation:{...en,sprint7:{admin:{imports:'Import onboarding',fileName:'File name',csv:'Paste CSV data',jobs:'Import jobs',noJobs:'No imports'}}}},fr:{translation:{...fr,sprint7:{admin:{imports:'Importer',fileName:'Fichier',csv:'CSV',jobs:'Historique',noJobs:'Aucun import'}}}}}});
vi.mock('../i18n/useTranslation',()=>({useTranslation:()=>({t:translator.t.bind(translator),i18n:translator})}));
vi.mock('react-native',()=>({Platform:{OS:'web'},StyleSheet:{create:(v:unknown)=>v},Text:({children}:{children:ReactNode})=><span>{children}</span>,View:({children}:{children:ReactNode})=><div>{children}</div>}));
vi.mock('expo-crypto',()=>({randomUUID:()=> 'stable'}));
vi.mock('../services/coreCompletion',()=>({loadImportJobs:vi.fn(),loadImportRows:vi.fn(),stageImport:vi.fn(),inspectImport:vi.fn(),commitImportJob:vi.fn()}));
vi.mock('../utils/exportCsv',()=>({exportCsv:vi.fn()}));
vi.mock('./ui',()=>({Button:({label,disabled}:{label:string;disabled:boolean})=><button disabled={disabled}>{label}</button>,TextField:({value,accessibilityLabel,editable}:{value:string;accessibilityLabel:string;editable:boolean})=><input aria-label={accessibilityLabel} defaultValue={value} disabled={!editable}/>,FormField:({children,label}:{children:ReactNode;label:string})=><label>{label}{children}</label>}));
describe('bilingual import surfaces',()=>{
 it.each(['en','fr'])('renders scoped onboarding without raw translation keys in %s',async locale=>{await translator.changeLanguage(locale);const html=renderToStaticMarkup(<ImportWorkbench userId="user" organizationId="org" branchId="branch" branchName="Main" currencyCode="CAD" allowed/>);expect(html).toContain('Main');expect(html).toContain(translator.t('imports.template'));expect(html).toContain(translator.t('imports.loadingHistory'));expect(html).not.toContain('imports.');expect(html).not.toContain('sprint7.');});
 it.each(['en','fr'])('shows destinations and ignored columns with accessible buttons in %s',async locale=>{await translator.changeLanguage(locale);const html=renderToStaticMarkup(<ImportColumnMapping type="PRODUCTS" headers={['Nom','Extra']} mapping={{Nom:'name',Extra:''}} disabled={false} onChange={()=>{}}/>);expect(html).toContain(translator.t('imports.fields.name'));expect(html).toContain(translator.t('imports.ignored'));expect(html).not.toContain('imports.');});
});
