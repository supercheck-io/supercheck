/**
 * System-generated status page messages.
 *
 * These are written into incident and update rows when the platform creates
 * them, so they use the status page's configured language at creation time.
 * Existing rows are never rewritten when the language changes.
 */

import type { SupportedLanguage } from "./status-page-translations";

export type StatusPageSystemMessages = {
  autoOutageTitle: string;
  autoOutageBody: string;
  recoveryBody: string;
  maintenanceStartBody: string;
  maintenanceEndBody: string;
  incidentCreatedBody: string;
};

const SYSTEM_MESSAGES: Record<SupportedLanguage, StatusPageSystemMessages> = {
  en: {
    autoOutageTitle: "{component} is experiencing an outage",
    autoOutageBody: "Monitoring detected an availability issue.",
    recoveryBody: "Monitoring confirms that service has recovered.",
    maintenanceStartBody: "Scheduled maintenance is in progress.",
    maintenanceEndBody: "Scheduled maintenance completed.",
    incidentCreatedBody: "Incident created: {name}",
  },
  ar: {
    autoOutageTitle: "{component} يواجه انقطاعًا في الخدمة",
    autoOutageBody: "اكتشف المراقبة مشكلة في التوفر.",
    recoveryBody: "تؤكد المراقبة أن الخدمة قد تعافت.",
    maintenanceStartBody: "الصيانة المجدولة قيد التنفيذ.",
    maintenanceEndBody: "اكتملت الصيانة المجدولة.",
    incidentCreatedBody: "تم إنشاء الحادث: {name}",
  },
  cs: {
    autoOutageTitle: "{component} má výpadek",
    autoOutageBody: "Monitorování zjistilo problém s dostupností.",
    recoveryBody: "Monitorování potvrzuje, že služba je obnovena.",
    maintenanceStartBody: "Probíhá plánovaná údržba.",
    maintenanceEndBody: "Plánovaná údržba byla dokončena.",
    incidentCreatedBody: "Incident vytvořen: {name}",
  },
  da: {
    autoOutageTitle: "{component} oplever et nedbrud",
    autoOutageBody: "Overvågningen har registreret et tilgængelighedsproblem.",
    recoveryBody: "Overvågningen bekræfter, at tjenesten er genoprettet.",
    maintenanceStartBody: "Planlagt vedligeholdelse er i gang.",
    maintenanceEndBody: "Planlagt vedligeholdelse er afsluttet.",
    incidentCreatedBody: "Hændelse oprettet: {name}",
  },
  de: {
    autoOutageTitle: "{component} hat eine Störung",
    autoOutageBody: "Die Überwachung hat ein Verfügbarkeitsproblem festgestellt.",
    recoveryBody: "Die Überwachung bestätigt, dass der Dienst wiederhergestellt ist.",
    maintenanceStartBody: "Die geplante Wartung läuft.",
    maintenanceEndBody: "Die geplante Wartung ist abgeschlossen.",
    incidentCreatedBody: "Vorfall erstellt: {name}",
  },
  es: {
    autoOutageTitle: "{component} está experimentando una interrupción",
    autoOutageBody: "La monitorización detectó un problema de disponibilidad.",
    recoveryBody: "La monitorización confirma que el servicio se ha recuperado.",
    maintenanceStartBody: "El mantenimiento programado está en curso.",
    maintenanceEndBody: "El mantenimiento programado ha finalizado.",
    incidentCreatedBody: "Incidente creado: {name}",
  },
  fi: {
    autoOutageTitle: "{component}-palvelussa on käyttökatko",
    autoOutageBody: "Valvonta havaitsi saatavuusongelman.",
    recoveryBody: "Valvonta vahvistaa, että palvelu on palautunut.",
    maintenanceStartBody: "Suunniteltu huolto on käynnissä.",
    maintenanceEndBody: "Suunniteltu huolto on valmis.",
    incidentCreatedBody: "Tapaus luotu: {name}",
  },
  fr: {
    autoOutageTitle: "{component} connaît une panne",
    autoOutageBody: "La surveillance a détecté un problème de disponibilité.",
    recoveryBody: "La surveillance confirme que le service est rétabli.",
    maintenanceStartBody: "La maintenance planifiée est en cours.",
    maintenanceEndBody: "La maintenance planifiée est terminée.",
    incidentCreatedBody: "Incident créé : {name}",
  },
  hi: {
    autoOutageTitle: "{component} में आउटेज आ रहा है",
    autoOutageBody: "मॉनिटरिंग ने उपलब्धता की समस्या का पता लगाया।",
    recoveryBody: "मॉनिटरिंग पुष्टि करती है कि सेवा बहाल हो गई है।",
    maintenanceStartBody: "निर्धारित रखरखाव जारी है।",
    maintenanceEndBody: "निर्धारित रखरखाव पूरा हुआ।",
    incidentCreatedBody: "घटना बनाई गई: {name}",
  },
  hr: {
    autoOutageTitle: "{component} ima prekid rada",
    autoOutageBody: "Nadzor je otkrio problem s dostupnošću.",
    recoveryBody: "Nadzor potvrđuje da je usluga obnovljena.",
    maintenanceStartBody: "Planirano održavanje je u tijeku.",
    maintenanceEndBody: "Planirano održavanje je dovršeno.",
    incidentCreatedBody: "Incident stvoren: {name}",
  },
  hu: {
    autoOutageTitle: "{component} kimaradást tapasztal",
    autoOutageBody: "A megfigyelés elérhetőségi problémát észlelt.",
    recoveryBody: "A megfigyelés megerősíti, hogy a szolgáltatás helyreállt.",
    maintenanceStartBody: "Az ütemezett karbantartás folyamatban van.",
    maintenanceEndBody: "Az ütemezett karbantartás befejeződött.",
    incidentCreatedBody: "Incidens létrehozva: {name}",
  },
  it: {
    autoOutageTitle: "{component} sta subendo un'interruzione",
    autoOutageBody: "Il monitoraggio ha rilevato un problema di disponibilità.",
    recoveryBody: "Il monitoraggio conferma che il servizio è stato ripristinato.",
    maintenanceStartBody: "La manutenzione programmata è in corso.",
    maintenanceEndBody: "La manutenzione programmata è completata.",
    incidentCreatedBody: "Incidente creato: {name}",
  },
  ja: {
    autoOutageTitle: "{component} で障害が発生しています",
    autoOutageBody: "監視により可用性の問題が検出されました。",
    recoveryBody: "監視により、サービスが復旧したことを確認しました。",
    maintenanceStartBody: "定期メンテナンスを実施中です。",
    maintenanceEndBody: "定期メンテナンスが完了しました。",
    incidentCreatedBody: "インシデントを作成しました: {name}",
  },
  ko: {
    autoOutageTitle: "{component}에 장애가 발생했습니다",
    autoOutageBody: "모니터링에서 가용성 문제가 감지되었습니다.",
    recoveryBody: "모니터링에서 서비스가 복구되었음을 확인했습니다.",
    maintenanceStartBody: "예정된 유지보수가 진행 중입니다.",
    maintenanceEndBody: "예정된 유지보수가 완료되었습니다.",
    incidentCreatedBody: "인시던트 생성됨: {name}",
  },
  nl: {
    autoOutageTitle: "{component} ondervindt een storing",
    autoOutageBody: "Monitoring heeft een beschikbaarheidsprobleem gedetecteerd.",
    recoveryBody: "Monitoring bevestigt dat de dienst is hersteld.",
    maintenanceStartBody: "Gepland onderhoud is bezig.",
    maintenanceEndBody: "Gepland onderhoud is voltooid.",
    incidentCreatedBody: "Incident aangemaakt: {name}",
  },
  no: {
    autoOutageTitle: "{component} opplever en driftsforstyrrelse",
    autoOutageBody: "Overvåkingen oppdaget et tilgjengelighetsproblem.",
    recoveryBody: "Overvåkingen bekrefter at tjenesten er gjenopprettet.",
    maintenanceStartBody: "Planlagt vedlikehold pågår.",
    maintenanceEndBody: "Planlagt vedlikehold er fullført.",
    incidentCreatedBody: "Hendelse opprettet: {name}",
  },
  pl: {
    autoOutageTitle: "{component} ma awarię",
    autoOutageBody: "Monitorowanie wykryło problem z dostępnością.",
    recoveryBody: "Monitorowanie potwierdza, że usługa została przywrócona.",
    maintenanceStartBody: "Trwa zaplanowana konserwacja.",
    maintenanceEndBody: "Zaplanowana konserwacja została zakończona.",
    incidentCreatedBody: "Utworzono incydent: {name}",
  },
  pt: {
    autoOutageTitle: "{component} está passando por uma interrupção",
    autoOutageBody: "O monitoramento detectou um problema de disponibilidade.",
    recoveryBody: "O monitoramento confirma que o serviço foi recuperado.",
    maintenanceStartBody: "A manutenção programada está em andamento.",
    maintenanceEndBody: "A manutenção programada foi concluída.",
    incidentCreatedBody: "Incidente criado: {name}",
  },
  ro: {
    autoOutageTitle: "{component} se confruntă cu o întrerupere",
    autoOutageBody: "Monitorizarea a detectat o problemă de disponibilitate.",
    recoveryBody: "Monitorizarea confirmă că serviciul a fost restabilit.",
    maintenanceStartBody: "Întreținerea programată este în curs.",
    maintenanceEndBody: "Întreținerea programată s-a încheiat.",
    incidentCreatedBody: "Incident creat: {name}",
  },
  ru: {
    autoOutageTitle: "{component}: наблюдается сбой",
    autoOutageBody: "Мониторинг обнаружил проблему с доступностью.",
    recoveryBody: "Мониторинг подтверждает, что сервис восстановлен.",
    maintenanceStartBody: "Идёт плановое техническое обслуживание.",
    maintenanceEndBody: "Плановое техническое обслуживание завершено.",
    incidentCreatedBody: "Инцидент создан: {name}",
  },
  sv: {
    autoOutageTitle: "{component} har en driftstörning",
    autoOutageBody: "Övervakningen upptäckte ett tillgänglighetsproblem.",
    recoveryBody: "Övervakningen bekräftar att tjänsten är återställd.",
    maintenanceStartBody: "Planerat underhåll pågår.",
    maintenanceEndBody: "Planerat underhåll är slutfört.",
    incidentCreatedBody: "Incident skapad: {name}",
  },
  tr: {
    autoOutageTitle: "{component} kesinti yaşıyor",
    autoOutageBody: "İzleme bir kullanılabilirlik sorunu tespit etti.",
    recoveryBody: "İzleme, hizmetin geri geldiğini doğruluyor.",
    maintenanceStartBody: "Planlı bakım sürüyor.",
    maintenanceEndBody: "Planlı bakım tamamlandı.",
    incidentCreatedBody: "Olay oluşturuldu: {name}",
  },
  uk: {
    autoOutageTitle: "{component}: спостерігається збій",
    autoOutageBody: "Моніторинг виявив проблему з доступністю.",
    recoveryBody: "Моніторинг підтверджує, що сервіс відновлено.",
    maintenanceStartBody: "Триває планове технічне обслуговування.",
    maintenanceEndBody: "Планове технічне обслуговування завершено.",
    incidentCreatedBody: "Інцидент створено: {name}",
  },
  zh: {
    autoOutageTitle: "{component} 正在发生故障",
    autoOutageBody: "监控检测到可用性问题。",
    recoveryBody: "监控确认服务已恢复。",
    maintenanceStartBody: "计划维护正在进行中。",
    maintenanceEndBody: "计划维护已完成。",
    incidentCreatedBody: "已创建事件：{name}",
  },
};

export function formatSystemMessage(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.split(`{${key}}`).join(value),
    template,
  );
}

/** Falls back to English for unknown or regional language codes. */
export function getSystemMessages(language: string): StatusPageSystemMessages {
  const normalized = language.split("-")[0]?.toLowerCase() ?? "";
  return (
    SYSTEM_MESSAGES[normalized as SupportedLanguage] ?? SYSTEM_MESSAGES.en
  );
}
