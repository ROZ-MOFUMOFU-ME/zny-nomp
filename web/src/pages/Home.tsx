import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { getAnnouncement, getConfig } from '../api/client.ts';
import { readableHashRateString } from '../lib/format.ts';
import ServersSection from '../components/ServersSection.tsx';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const line = 'whitespace-nowrap py-0.5';
const item = 'min-w-[150px] rounded-lg bg-white/15 px-3.5 py-2';

// Shown in the hero when config doesn't set branding.home.highlights.
// Translated via i18n; config overrides use raw strings (single language).
const DEFAULT_HIGHLIGHTS: Array<{ icon: string; key: string }> = [
    { icon: 'fas fa-user-shield', key: 'home_highlight_nokyc' },
    { icon: 'fas fa-user-secret', key: 'home_highlight_anonymous' },
    { icon: 'fas fa-user-slash', key: 'home_highlight_noreg' }
];

// Solid section backgrounds at -500 (same brightness as the accent tokens, so
// white text stays consistent with hero/Stats/Pools, without being as dark as
// -600/-700). No red (reserved for warnings) and avoiding the brand hues
// (accent=cyan, accent2=purple, accent3=green); servers uses slate.
const SECTION_BG = [
    'bg-amber-500',
    'bg-blue-500',
    'bg-orange-500',
    'bg-indigo-500'
];

export default function Home() {
    const { t } = useTranslation();
    const stats = useLiveStats();
    const algos = stats ? Object.entries(stats.algos) : [];
    const pools = stats ? Object.values(stats.pools) : [];
    const announcement = useQuery({
        queryKey: ['announcement'],
        queryFn: getAnnouncement
    });
    const note = announcement.data?.announcement?.trim();
    const config = useQuery({ queryKey: ['config'], queryFn: getConfig });
    const branding = config.data?.branding;
    const home = branding?.home;
    const siteName = branding?.siteName || 'zny-nomp';
    // The hero has its own logo, falling back to the header/site logo.
    const logo = home?.logo || branding?.logo || '/logo.svg';
    // Home-hero "facts" come from config.json website.branding.home — render
    // only the labels whose value the operator actually filled in.
    const factDefs: Array<[string, string | undefined]> = [
        ['home_min_payout', home?.minPayout],
        ['home_payment_interval', home?.paymentInterval],
        ['home_pool_fee', home?.poolFee],
        ['home_payment_method', home?.paymentMethod]
    ];
    const facts = factDefs.filter((f): f is [string, string] => Boolean(f[1]));
    // Hero heading: an explicit title wins (multi-coin pools), else the
    // {{coin}} i18n template (single coin, translated), else just the site name.
    const heroTitle = home?.title
        ? home.title
        : home?.coin
          ? t('home_welcome_title', { site: siteName, coin: home.coin })
          : siteName;
    // Operator-authored custom HTML sections (config.json is a trusted source).
    const sectionList = home?.sections;
    const sections = (Array.isArray(sectionList) ? sectionList : []).filter(
        (s) => s && s.html
    );
    const servers = home?.servers;
    // Hero highlight badges: config overrides (raw strings), [] hides, omitted
    // = translated defaults.
    const customHighlights = Array.isArray(home?.highlights)
        ? home.highlights
        : null;
    const highlightItems = customHighlights
        ? customHighlights.map((h) =>
              typeof h === 'string'
                  ? { icon: 'fas fa-check', text: h }
                  : { icon: h.icon || 'fas fa-check', text: h.text }
          )
        : DEFAULT_HIGHLIGHTS.map((d) => ({ icon: d.icon, text: t(d.key) }));

    return (
        <div>
            {note && (
                <section className="mb-5 rounded-xl border-l-4 border-accent bg-accent/10 px-5 py-4">
                    <div className="mb-1 font-bold text-accent">
                        <i className="fas fa-bullhorn fa-fw" />{' '}
                        {t('home_announcement')}
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{note}</div>
                </section>
            )}
            <section className="mb-5 flex flex-wrap items-center gap-6 rounded-xl bg-accent px-8 py-7 text-white">
                <img
                    src={logo}
                    alt={siteName}
                    className="h-auto w-[200px] max-w-[40%]"
                />
                <div className="flex-1 basis-80">
                    <h1 className="mb-3 text-4xl font-bold">{heroTitle}</h1>
                    {facts.length > 0 && (
                        <ul className="m-0 list-none p-0 text-lg leading-loose [&>li]:before:mr-2.5 [&>li]:before:opacity-80 [&>li]:before:content-['✦']">
                            {facts.map(([key, value]) => (
                                <li key={key}>{t(key, { value })}</li>
                            ))}
                        </ul>
                    )}
                    {highlightItems.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {highlightItems.map((h, i) => (
                                <span
                                    key={i}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-sm font-medium"
                                >
                                    <i className={`${h.icon} fa-fw`} /> {h.text}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            {sections.length > 0 && (
                <div className="mb-5 flex flex-col gap-5">
                    {sections.map((s, i) => (
                        <section
                            key={i}
                            className={`rounded-xl px-5 py-4 text-white ${SECTION_BG[i % SECTION_BG.length]}`}
                        >
                            {s.title && (
                                <div className="mb-3 text-xl font-bold">
                                    {s.title}
                                </div>
                            )}
                            {/* Operator HTML from config.json (trusted source). */}
                            <div
                                className="leading-relaxed [&_a]:text-white [&_a]:underline [&_code]:rounded [&_code]:bg-white/20 [&_code]:px-1.5 [&_code]:py-0.5 [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-white/10 [&_pre]:p-3 [&_table]:my-2 [&_td]:border [&_td]:border-white/30 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/30 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
                                dangerouslySetInnerHTML={{ __html: s.html }}
                            />
                        </section>
                    ))}
                </div>
            )}

            {servers && <ServersSection servers={servers} />}

            <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
                <section className="rounded-xl bg-accent2 px-5 py-4 text-white">
                    <div className="mb-3 text-xl font-bold">
                        {t('home_global_stats')}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                        {!stats ? (
                            <div className="text-white/80">
                                {t('home_loading')}
                            </div>
                        ) : algos.length ? (
                            algos.map(([algo, a]) => (
                                <div className={item} key={algo}>
                                    <div className={line}>
                                        <i className="fas fa-flask fa-fw" />{' '}
                                        {cap(algo)}
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-users fa-fw" />{' '}
                                        {t('home_miners', { count: a.workers })}
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                                        {a.hashrateString ||
                                            readableHashRateString(a.hashrate)}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-white/80">
                                {t('home_no_active_algorithms')}
                            </div>
                        )}
                    </div>
                </section>

                <section className="rounded-xl bg-accent3 px-5 py-4 text-white">
                    <div className="mb-3 text-xl font-bold">
                        {t('home_pools_coins')}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                        {!stats ? (
                            <div className="text-white/80">
                                {t('home_loading')}
                            </div>
                        ) : pools.length ? (
                            pools.map((p) => (
                                <div className={item} key={p.name}>
                                    <div className={line}>
                                        <i className="fas fa-coins fa-fw" />{' '}
                                        {cap(p.name)}
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-users fa-fw" />{' '}
                                        {t('home_miners', {
                                            count: p.workerCount ?? 0
                                        })}
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                                        {p.hashrateString ||
                                            readableHashRateString(p.hashrate)}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-white/80">
                                {t('home_no_pools_configured')}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
