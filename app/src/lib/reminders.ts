import { addDays } from './clock';
import { one } from './db';

/**
 * Reminders and escalation: who hears what, on which channel, in which language.
 *
 * The sweep (reminderSweep in write.ts) decides *when*; this file holds the words and the
 * timeline the task page draws. Three steps per task, each sent once:
 *
 *   T−2      the owner is reminded two days before the due date
 *   breach   the day after the due date passes without proof, the owner gets one overdue nudge
 *            and the block officer (BEO of the case's block) is told
 *   +7       seven days after the due date, the district officer (DEO) gets the escalation
 *
 * Everybody gets the in-app notification. People who do not use the web app — most headmasters
 * and some cluster coordinators — are reached on the channel stored on their user row
 * (users.preferred_channel: whatsapp, ivr or sms), in their language (users.preferred_language).
 * Those messages go to the simulated outbox, marked as not delivered: no gateway is connected.
 *
 * Apart from reachOf(), nothing here reads the database, so the words can be tested alone.
 */

export type Step = 'reminder' | 'breach' | 'escalation';
export type Lang = 'en' | 'hi';
export type OutChannel = 'whatsapp' | 'ivr' | 'sms';

/** Channels that are not the web app. 'app' users are reached by the in-app notification alone. */
export function outboxChannel(preferred: string | null | undefined): OutChannel | null {
  return preferred === 'whatsapp' || preferred === 'ivr' || preferred === 'sms' ? preferred : null;
}

export const langOf = (preferred: string | null | undefined): Lang => (preferred === 'hi' ? 'hi' : 'en');

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HI_MONTHS = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];

/** '2026-11-02' → '2 Nov 2026' / '2 नवंबर 2026'. Spoken and read the same way. */
export function spokenDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${(lang === 'hi' ? HI_MONTHS : EN_MONTHS)[m - 1]} ${y}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface MessageContext {
  title: string;     // the task title in the recipient's language
  due: string;       // YYYY-MM-DD
  owner?: string;    // the owner's name, for messages to officers
  block?: string;    // the block's name, for the district officer
}

/** The outbox template name each step is stored under, per recipient. */
export const TEMPLATE = {
  reminder: 'reminder_t_minus_2',
  breach: 'overdue_nudge',
  breach_officer: 'overdue_block_officer',
  escalation: 'escalation_7_days',
} as const;
export type Template = typeof TEMPLATE[keyof typeof TEMPLATE];

/**
 * The message text. WhatsApp gets the full sentence, SMS a short one, and IVR a voice script
 * that is read aloud: a greeting, the message, and the keys to press.
 */
export function messageFor(template: Template, channel: OutChannel, lang: Lang, ctx: MessageContext): string {
  const due = spokenDate(ctx.due, lang);
  const t = channel === 'sms' ? clip(ctx.title, 50) : clip(ctx.title, 90);
  const owner = ctx.owner ?? (lang === 'hi' ? 'ज़िम्मेदार व्यक्ति' : 'the owner');
  const block = ctx.block ?? (lang === 'hi' ? 'आपका ज़िला' : 'your district');

  if (template === TEMPLATE.reminder) {
    if (channel === 'ivr') {
      return lang === 'hi'
        ? `नमस्ते। यह कार्यवाही की ओर से अनुस्मारक है। आपका काम "${t}" ${due} तक पूरा होना है। कृपया तब तक सबूत भेज दें। यह संदेश दोबारा सुनने के लिए 1 दबाएँ। कोई समस्या बताने के लिए 2 दबाएँ।`
        : `Namaste. This is a reminder from Karyavahi. Your task "${t}" is due on ${due}. Please send the proof by then. To hear this message again, press 1. To report a problem, press 2.`;
    }
    if (channel === 'sms') {
      return lang === 'hi'
        ? `कार्यवाही: "${t}" की अंतिम तिथि ${due}। समय पर सबूत भेजें।`
        : `Karyavahi: "${t}" is due ${due}. Send proof by then.`;
    }
    return lang === 'hi'
      ? `कार्यवाही अनुस्मारक: "${t}" की अंतिम तिथि ${due} है। कृपया तब तक सबूत भेज दें।`
      : `Karyavahi reminder: "${t}" is due on ${due}. Please send the proof by then.`;
  }

  if (template === TEMPLATE.breach) {
    if (channel === 'ivr') {
      return lang === 'hi'
        ? `नमस्ते। यह कार्यवाही की ओर से संदेश है। आपके काम "${t}" की अंतिम तिथि ${due} निकल चुकी है, और अभी तक सबूत नहीं आया। कृपया जल्द से जल्द सबूत भेजें। यह संदेश दोबारा सुनने के लिए 1 दबाएँ। काम में रुकावट बताने के लिए 2 दबाएँ।`
        : `Namaste. This is Karyavahi. Your task "${t}" was due on ${due}, and no proof has come in yet. Please send it as soon as you can. To hear this message again, press 1. To tell us what is holding it up, press 2.`;
    }
    if (channel === 'sms') {
      return lang === 'hi'
        ? `कार्यवाही: "${t}" की तिथि ${due} निकल गई। सबूत अभी नहीं आया, कृपया भेजें।`
        : `Karyavahi: "${t}" was due ${due}. No proof yet, please send it.`;
    }
    return lang === 'hi'
      ? `कार्यवाही: "${t}" की अंतिम तिथि ${due} निकल गई है और सबूत नहीं आया। कृपया सबूत भेजें, या अपने अधिकारी को बताएँ कि काम कहाँ रुका है।`
      : `Karyavahi: "${t}" was due on ${due} and no proof has come in. Please send the proof, or tell your officer what is holding it up.`;
  }

  if (template === TEMPLATE.breach_officer) {
    if (channel === 'ivr') {
      return lang === 'hi'
        ? `नमस्ते। यह कार्यवाही की ओर से संदेश है। आपके ब्लॉक में ${owner} को सौंपे गए काम "${t}" की अंतिम तिथि ${due} बिना सबूत के निकल गई है। यह संदेश दोबारा सुनने के लिए 1 दबाएँ।`
        : `Namaste. This is Karyavahi. In your block, the task "${t}" given to ${owner} passed its due date of ${due} without proof. To hear this message again, press 1.`;
    }
    if (channel === 'sms') {
      return lang === 'hi'
        ? `कार्यवाही: आपके ब्लॉक में "${t}" (${owner}) की तिथि ${due} बिना सबूत निकल गई।`
        : `Karyavahi: in your block, "${t}" (${owner}) passed ${due} without proof.`;
    }
    return lang === 'hi'
      ? `कार्यवाही: आपके ब्लॉक में "${t}" (${owner}) की अंतिम तिथि ${due} बिना सबूत के निकल गई है।`
      : `Karyavahi: in your block, "${t}" (${owner}) passed its due date of ${due} without proof.`;
  }

  // escalation
  if (channel === 'ivr') {
    return lang === 'hi'
      ? `नमस्ते। यह कार्यवाही की ओर से संदेश है। ${block} में ${owner} को सौंपे गए काम "${t}" की अंतिम तिथि ${due} को सात दिन बीत गए हैं, और सबूत नहीं आया। यह मामला आपको भेजा गया है। यह संदेश दोबारा सुनने के लिए 1 दबाएँ।`
      : `Namaste. This is Karyavahi. The task "${t}" given to ${owner} in ${block} is seven days past its due date of ${due}, with no proof. It has been escalated to you. To hear this message again, press 1.`;
  }
  if (channel === 'sms') {
    return lang === 'hi'
      ? `कार्यवाही: "${t}" (${owner}, ${block}) की तिथि ${due} को 7 दिन बीते, सबूत नहीं।`
      : `Karyavahi escalation: "${t}" (${owner}, ${block}) is 7 days past ${due}, no proof.`;
  }
  return lang === 'hi'
    ? `कार्यवाही: "${t}" (${owner}, ${block}) की अंतिम तिथि ${due} को 7 दिन बीत गए, सबूत अब तक नहीं आया। यह मामला आपको भेजा गया है।`
    : `Karyavahi escalation: "${t}" (${owner}, ${block}) is 7 days past its due date of ${due} with no proof. It has been escalated to you.`;
}

// ---------------------------------------------------------------- the task page's timeline
export interface TimelineTask {
  due_date: string; submitted_at: string | null;
  reminder_sent_at: string | null; breach_nudged_at?: string | null; escalated_at: string | null;
}

export type StepState = 'sent' | 'planned' | 'pending_run' | 'not_needed' | 'not_sent';

export interface TimelineStep {
  step: Step;
  /** When it went out (a timestamp), or the date it is due to go out. */
  at: string;
  state: StepState;
}

/**
 * Where each of the three steps stands for one task, measured against the demo clock's `today`.
 * - sent: it went out (the timestamp is on the task)
 * - planned: its day has not come yet
 * - pending_run: its day has come; the next sweep sends it (the scheduler runs hourly)
 * - not_needed: proof came in before its day
 * - not_sent: its window closed without it (a task given too close to its deadline gets no
 *   T−2 reminder; a task already escalated in the seed got no separate nudge)
 */
export function reminderTimeline(t: TimelineTask, today: string): TimelineStep[] {
  const due = t.due_date.slice(0, 10);
  const submittedDay = t.submitted_at ? t.submitted_at.slice(0, 10) : null;
  const plan: [Step, string, string | null | undefined][] = [
    ['reminder', addDays(due, -2), t.reminder_sent_at],
    ['breach', addDays(due, 1), t.breach_nudged_at],
    ['escalation', addDays(due, 7), t.escalated_at],
  ];
  return plan.map(([step, day, sentAt]) => {
    if (sentAt) return { step, at: sentAt, state: 'sent' as const };
    if (submittedDay) return { step, at: day, state: 'not_needed' as const };
    if (day > today) return { step, at: day, state: 'planned' as const };
    // Its day has come and nothing went out. The reminder's window closes at the due date and
    // the nudge's at escalation; after that the sweep will not send it late.
    if (step === 'reminder' && due < today) return { step, at: day, state: 'not_sent' as const };
    if (step === 'breach' && t.escalated_at) return { step, at: day, state: 'not_sent' as const };
    return { step, at: day, state: 'pending_run' as const };
  });
}

// ---------------------------------------------------------------- how a person is reached
export const CHANNEL_NAME: Record<'app' | OutChannel, { en: string; hi: string }> = {
  app: { en: 'the app', hi: 'ऐप' },
  whatsapp: { en: 'WhatsApp', hi: 'व्हाट्सऐप' },
  ivr: { en: 'IVR call', hi: 'आईवीआर कॉल' },
  sms: { en: 'SMS', hi: 'एसएमएस' },
};

/** The channel and language a person is reached on, from their user row. */
export function reachOf(userId: string): { channel: 'app' | OutChannel; language: Lang } {
  const u = one<{ preferred_channel: string | null; preferred_language: string | null }>(
    'select preferred_channel, preferred_language from users where id = ?', userId,
  );
  return { channel: outboxChannel(u?.preferred_channel) ?? 'app', language: langOf(u?.preferred_language) };
}
