import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { Receipt } from './Receipt';
import { ReportSummary } from './ReportSummary';
import type { SaleDetailData } from '../services/posCompletion';
import en from '../i18n/posReady.en.json';
import fr from '../i18n/posReady.fr.json';
const i18n=createInstance(); void i18n.init({initAsync:false,lng:'en',resources:{en:{translation:en},fr:{translation:fr}}});
vi.mock('../i18n/useTranslation',()=>({useTranslation:()=>({t:i18n.t.bind(i18n),i18n})}));
vi.mock('react-native',()=>({Text:({children}:{children:ReactNode})=><span>{children}</span>,View:({children}:{children:ReactNode})=><div>{children}</div>}));
vi.mock('./ui',()=>({Alert:({title}:{title:string})=><p>{title}</p>}));
const detail={sale:{sale_number:'SETTINGS-QA',currency_code:'CAD',completed_at:'2026-11-18T02:00:00Z',total_amount:10,status:'COMPLETED',discount_total:0},items:[],payments:[],cashier:'QA'} as unknown as SaleDetailData;
describe('configured receipt and missing currency presentation',()=>{
  it.each(['en','fr'])('renders identity/footer and explicit branch date in %s',async language=>{
    await i18n.changeLanguage(language);const html=renderToStaticMarkup(<Receipt detail={detail} business="Pharmacie QA" branch="Main" timezone="America/Toronto" address="18 Rue Locale" contact="pharmacy@example.test" footer="Merci configuré" />);
    for(const text of ['Pharmacie QA','18 Rue Locale','pharmacy@example.test','Merci configuré','17','10'])expect(html).toContain(text);
  });
  it('does not crash or invent money when organization currency is missing',()=>{
    const report={summary:{gross:10},rows:[],start:'2026-11-18',end:'2026-11-18',timezone:'UTC',generated_at:'2026-11-18T00:00Z'};
    const html=renderToStaticMarkup(<ReportSummary report={report as never} kind="sales" currency="" branchName="Main" pending={0} conflicts={0} />); expect(html).not.toContain('XOF'); expect(html).toContain('—');
  });
});
