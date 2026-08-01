import { motion } from "motion/react";
import { Trans, useTranslation } from "react-i18next";
import {
  ShieldCheck,
  Target,
  Lightbulb,
  Cpu,
  Code,
  FileText,
  LineChart,
  UserCheck,
} from "lucide-react";

export default function About() {
  const { t } = useTranslation();
  // Names are proper nouns and stay as-is in every language; roles and bios
  // are prose and come from the locale files.
  const TEAM_MEMBERS = [
    { name: "Dr. Evelyn Carter", image: "EC", roleKey: "about.teamRole1", bioKey: "about.teamBio1" },
    { name: "Marcus Sterling", image: "MS", roleKey: "about.teamRole2", bioKey: "about.teamBio2" },
    { name: "Siddharth Mehta", image: "SM", roleKey: "about.teamRole3", bioKey: "about.teamBio3" },
  ];
  const objectives = [
    {
      icon: Target,
      title: t('about.objectiveAccuracyTitle'),
      desc: t('about.objectiveAccuracyDesc'),
    },
    {
      icon: Lightbulb,
      title: t('about.objectiveAccessTitle'),
      desc: t('about.objectiveAccessDesc'),
    },
    {
      icon: ShieldCheck,
      title: t('about.objectivePrivacyTitle'),
      desc: t('about.objectivePrivacyDesc'),
    },
  ];

  const technologies = [
    {
      category: t('about.stackFrontendCategory'),
      icon: Code,
      items: [
        t('about.stackFrontend1'),
        t('about.stackFrontend2'),
        t('about.stackFrontend3'),
        t('about.stackFrontend4'),
      ],
    },
    {
      category: t('about.stackAiCategory'),
      icon: Cpu,
      items: [
        t('about.stackAi1'),
        t('about.stackAi2'),
        t('about.stackAi3'),
        t('about.stackAi4'),
      ],
    },
    {
      category: t('about.stackDataCategory'),
      icon: LineChart,
      items: [
        t('about.stackData1'),
        t('about.stackData2'),
        t('about.stackData3'),
        t('about.stackData4'),
      ],
    },
  ];

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen">
      {/* Page Title & Hero */}
      <section className="bg-gradient-to-r from-brand-primary to-slate-900 text-white py-16 px-4 mb-12">
        <div className="max-w-7xl mx-auto text-center space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display font-bold text-4xl sm:text-5xl tracking-tight"
          >
            {t('about.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('about.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20">
        {/* Project Description Section */}
        <section className="bg-white p-8 sm:p-12 rounded-3xl shadow-sm border border-slate-100">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <span className="text-xs font-bold text-brand-accent tracking-widest uppercase block">
                {t('about.genesisEyebrow')}
              </span>
              <h2 className="font-display font-bold text-3xl text-slate-900 tracking-tight">
                {t('about.genesisTitle')}
              </h2>
              <p className="text-slate-600 text-sm leading-relaxed">
                {t('about.genesisPara1')}
              </p>
              {/* <Trans> rather than a plain t(): the bolded product name sits
                  mid-sentence, and each language needs to place it where its
                  own grammar puts the subject. */}
              <p className="text-slate-600 text-sm leading-relaxed">
                <Trans i18nKey="about.genesisPara2" components={{ b: <strong /> }} />
              </p>
            </div>
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex flex-col justify-center space-y-4">
              <div className="flex items-center space-x-3 text-brand-primary">
                <FileText className="w-8 h-8 text-brand-secondary shrink-0" />
                <span className="font-display font-bold text-lg">
                  {t('about.blueprintLabel')}
                </span>
              </div>
              <blockquote className="border-l-4 border-brand-accent pl-4 text-slate-500 text-xs italic leading-relaxed">
                {t('about.blueprintQuote')}
              </blockquote>
              <div className="pt-2 text-xs font-mono text-slate-400">
                {t('about.blueprintAttribution')}
              </div>
            </div>
          </div>
        </section>

        {/* Objectives Section */}
        <section className="space-y-12">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">
              {t('about.objectivesEyebrow')}
            </h2>
            <p className="font-display font-bold text-3xl text-slate-900 tracking-tight">
              {t('about.objectivesTitle')}
            </p>
            <div className="w-12 h-1 bg-brand-accent mx-auto mt-3 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {objectives.map((obj, i) => (
              <div
                key={i}
                className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm space-y-4 hover:shadow-md transition-shadow duration-200"
              >
                <div className="w-12 h-12 rounded-xl bg-brand-bg flex items-center justify-center text-brand-primary">
                  <obj.icon className="w-6 h-6 text-brand-secondary" />
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900">
                  {obj.title}
                </h3>
                <p className="text-slate-600 text-xs leading-relaxed">
                  {obj.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Technologies Used Section */}
        <section className="space-y-12">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">
              {t('about.stackEyebrow')}
            </h2>
            <p className="font-display font-bold text-3xl text-slate-900 tracking-tight">
              {t('about.stackTitle')}
            </p>
            <div className="w-12 h-1 bg-brand-accent mx-auto mt-3 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {technologies.map((tech, i) => (
              <div
                key={i}
                className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center space-x-3 mb-6">
                    <div className="p-2.5 bg-brand-primary/10 rounded-lg text-brand-primary">
                      <tech.icon className="w-5 h-5 text-brand-primary" />
                    </div>
                    <h3 className="font-display font-bold text-base text-slate-900">
                      {tech.category}
                    </h3>
                  </div>
                  <ul className="space-y-3.5">
                    {tech.items.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start text-xs text-slate-600 leading-relaxed"
                      >
                        <span className="text-brand-accent mr-2 mt-1 shrink-0 font-bold">
                          &#10003;
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-8 pt-4 border-t border-slate-100 text-[10px] font-mono text-slate-400">
                  {t('about.verifiedSandboxModule', { num: i + 1 })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Team Information Section */}
        <section className="space-y-12">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">
              {t('about.teamEyebrow')}
            </h2>
            <p className="font-display font-bold text-3xl text-slate-900 tracking-tight">
              {t('about.teamTitle')}
            </p>
            <div className="w-12 h-1 bg-brand-accent mx-auto mt-3 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {TEAM_MEMBERS.map((member, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -5 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col"
              >
                {/* Simulated profile avatar box */}
                <div className="bg-gradient-to-br from-brand-primary to-slate-900 h-32 flex items-center justify-center relative">
                  <div className="absolute -bottom-10 w-20 h-20 bg-brand-accent border-4 border-white rounded-full flex items-center justify-center shadow-md">
                    <span className="text-white font-display font-bold text-xl">
                      {member.image}
                    </span>
                  </div>
                </div>
                <div className="p-6 pt-12 text-center flex-grow flex flex-col justify-between">
                  <div>
                    <h3 className="font-display font-bold text-lg text-slate-900">
                      {member.name}
                    </h3>
                    <p className="text-xs font-mono font-medium text-brand-secondary mb-3 uppercase tracking-wider">
                      {t(member.roleKey)}
                    </p>
                    <p className="text-slate-600 text-xs leading-relaxed">
                      {t(member.bioKey)}
                    </p>
                  </div>
                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center space-x-1.5 text-[11px] text-slate-400 font-mono">
                    <UserCheck className="w-3.5 h-3.5 text-brand-accent" />
                    <span>{t('about.credentialsSigned')}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
