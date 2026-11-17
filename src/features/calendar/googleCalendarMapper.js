export class GoogleCalendarMappingError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "GoogleCalendarMappingError";
  }
}

export async function mapCalendarEventToGoogleCalendarEvent(
  event,
  { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } = {},
) {
  if (
    !event ||
    typeof event.id !== "string" ||
    typeof event.title !== "string" ||
    !["appointment", "deadline"].includes(event.type)
  ) {
    throw new GoogleCalendarMappingError("Google Calendarへ変換する予定データが正しくありません。");
  }

  const startTime = event.type === "appointment" ? event.startTime : event.dueTime;
  const start = createLocalDateTime(event.date, startTime, timeZone);
  const end = new Date(
    start.getTime() +
      (event.type === "appointment" ? requireAppointmentDuration(event) * 60_000 : 0),
  );
  const googleEvent = {
    id: await createGoogleEventId(event.id),
    summary: event.title,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        dailyTool: "hibi-tool",
        dailyToolEventId: event.id,
      },
    },
  };

  if (event.type === "appointment") {
    if (event.location) {
      googleEvent.location = event.location;
    }
    googleEvent.description = [
      `移動時間: ${event.travelMinutes}分`,
      `準備時間: ${event.preparationMinutes}分`,
      `到着希望: 開始${event.arrivalLeadMinutes}分前`,
    ].join("\n");
  } else {
    googleEvent.endTimeUnspecified = true;
  }

  return googleEvent;
}

function requireAppointmentDuration(event) {
  if (
    !Number.isSafeInteger(event.durationMinutes) ||
    event.durationMinutes < 1 ||
    event.durationMinutes > 1440
  ) {
    throw new GoogleCalendarMappingError("予定の長さは1〜1440分で入力してください。");
  }
  return event.durationMinutes;
}

function createLocalDateTime(date, time, timeZone) {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    throw new GoogleCalendarMappingError("予定の日付または時刻が正しくありません。");
  }

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetLocalValue = Date.UTC(year, month - 1, day, hour, minute);
  const normalizedDate = new Date(targetLocalValue);
  if (
    normalizedDate.getUTCFullYear() !== year ||
    normalizedDate.getUTCMonth() !== month - 1 ||
    normalizedDate.getUTCDate() !== day
  ) {
    throw new GoogleCalendarMappingError("予定の日付または時刻が正しくありません。");
  }
  let timestamp = targetLocalValue;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch (cause) {
    throw new GoogleCalendarMappingError("タイムゾーンを認識できません。", { cause });
  }

  const getDisplayedParts = (value) =>
    Object.fromEntries(
      formatter
        .formatToParts(new Date(value))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const displayed = getDisplayedParts(timestamp);
    const displayedLocalValue = Date.UTC(
      displayed.year,
      displayed.month - 1,
      displayed.day,
      displayed.hour,
      displayed.minute,
      displayed.second,
    );
    const difference = targetLocalValue - displayedLocalValue;
    if (difference === 0) {
      return new Date(timestamp);
    }
    timestamp += difference;
  }

  const displayed = getDisplayedParts(timestamp);
  if (
    Number.isNaN(timestamp) ||
    displayed.year !== year ||
    displayed.month !== month ||
    displayed.day !== day ||
    displayed.hour !== hour ||
    displayed.minute !== minute
  ) {
    throw new GoogleCalendarMappingError("この日付・時刻は現在のタイムゾーンでは利用できません。");
  }
  return new Date(timestamp);
}

async function createGoogleEventId(localId) {
  if (!globalThis.crypto?.subtle) {
    throw new GoogleCalendarMappingError("Google Calendar用の予定IDを生成できません。");
  }
  const input = new TextEncoder().encode(`hibi-tool:${localId}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  const hexDigest = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `d${hexDigest}`;
}
