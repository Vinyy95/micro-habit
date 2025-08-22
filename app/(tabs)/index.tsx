import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// ---------- Types ----------
type Habit = {
  id: string;
  title: string;
  done: boolean;
  streak: number;
  lastDoneDate: string | null; // "YYYY-MM-DD"
  notes: { id: string; text: string; date: string }[];
  reminders: string[]; // "HH:MM"
  notifMap?: Record<string, string>; // time -> notificationId
  history: string[]; // dates that were completed (for weekly dots)
  createdAt: string;
};

// ---------- Constants ----------
const STORAGE_KEY = "HABITS_V1";
const LAST_ROLLOVER_KEY = "LAST_ROLLOVER_V1";
const BG_TASK = "HABIT_ROLLOVER_TASK";

const THEME = {
  bg: "#0d1117",
  card: "#111827",
  text: "#e5e7eb",
  sub: "#9ca3af",
  accent: "#22c55e",
  accentDim: "#16a34a",
  danger: "#ef4444",
  chip: "#1f2937",
  input: "#111827",
  border: "#374151",
};

const QUOTES = [
  "One step today > ten tomorrow.",
  "Small wins compound.",
  "Show up first, optimize later.",
  "Streaks are built daily.",
  "You don’t need more time — just one action.",
];

// ---------- Date helpers ----------
const todayStr = () => new Date().toISOString().slice(0, 10);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isYesterday = (iso?: string | null) => {
  if (!iso) return false;
  const d = new Date(iso + "T00:00:00");
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return ymd(y) === ymd(d);
};
const isToday = (iso?: string | null) => iso === todayStr();

// ---------- Notifications setup ----------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldSetBadge: false,
    shouldPlaySound: false,
  }),
});

async function ensureNotifPermission() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== "granted") {
      Alert.alert(
        "Notifications disabled",
        "You can enable notifications in Settings later."
      );
    }
  }
}

function parseTimeToHM(t: string): { hour: number; minute: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

async function scheduleDaily(habitId: string, title: string, t: string) {
  const hm = parseTimeToHM(t);
  if (!hm) throw new Error("Bad time");
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "Habit time",
      body: `"${title}" — keep your streak alive 🔥`,
    },
    trigger: { hour: hm.hour, minute: hm.minute, repeats: true },
  });
  return id; // notification id
}

async function cancelNotification(id?: string) {
  if (id) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {}
  }
}

// ---------- BG rollover task (no-op in Expo Go, but we keep it safe) ----------
TaskManager.defineTask(BG_TASK, async () => {
  try {
    const last = (await AsyncStorage.getItem(LAST_ROLLOVER_KEY)) || "";
    const today = todayStr();
    if (last === today) return BackgroundFetch.Result.NoData;

    const raw = (await AsyncStorage.getItem(STORAGE_KEY)) || "[]";
    const habits: Habit[] = JSON.parse(raw);

    const rolled = habits.map((h) => {
      // If you did it yesterday, keep streak; if not, streak to 0
      const keep = isYesterday(h.lastDoneDate);
      const newStreak = keep ? h.streak : 0;
      return {
        ...h,
        done: false,
        streak: newStreak,
      };
    });

    await AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(rolled)],
      [LAST_ROLLOVER_KEY, today],
    ]);

    return BackgroundFetch.Result.NewData;
  } catch {
    return BackgroundFetch.Result.Failed;
  }
});

async function registerBgTask() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.Status.Restricted) return;

    const registered = await TaskManager.isTaskRegisteredAsync(BG_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(BG_TASK, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {
    // Expo Go will land here — that’s fine.
  }
}

// ---------- Component ----------
export default function Screen() {
  // state
  const [habits, setHabits] = useState<Habit[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<Record<string, string>>({}); // habitId -> note input
  const [timeText, setTimeText] = useState<Record<string, string>>({}); // habitId -> HH:MM input
  const initialized = useRef(false);

  // progress + quote
  const completedCount = habits.filter((h) => h.done).length;
  const progress = habits.length ? completedCount / habits.length : 0;
  const quote = useMemo(
    () => QUOTES[new Date().getDate() % QUOTES.length],
    []
  );

  // load once
  useEffect(() => {
    (async () => {
      await ensureNotifPermission();
      await registerBgTask();

      const raw = (await AsyncStorage.getItem(STORAGE_KEY)) || "[]";
      const parsed: Habit[] = JSON.parse(raw);

      // midnight rollover if needed (when app was kept open)
      const last = (await AsyncStorage.getItem(LAST_ROLLOVER_KEY)) || "";
      const today = todayStr();
      let data = parsed;
      if (last !== today) {
        data = parsed.map((h) => ({
          ...h,
          done: false,
          streak: isYesterday(h.lastDoneDate) ? h.streak : 0,
        }));
        await AsyncStorage.multiSet([
          [STORAGE_KEY, JSON.stringify(data)],
          [LAST_ROLLOVER_KEY, today],
        ]);
      }

      initialized.current = true;
      setHabits(data);
    })();
  }, []);

  // persist whenever habits change
  useEffect(() => {
    if (!initialized.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(habits)).catch(() => {});
  }, [habits]);

  // actions
  const addHabit = useCallback(() => {
    const title = text.trim();
    if (!title) return;
    const now = new Date();
    const h: Habit = {
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      done: false,
      streak: 0,
      lastDoneDate: null,
      notes: [],
      reminders: [],
      notifMap: {},
      history: [],
      createdAt: now.toISOString(),
    };
    setHabits((arr) => [h, ...arr]);
    setText("");
    Keyboard.dismiss();
  }, [text]);

  const toggleDone = useCallback((id: string) => {
    setHabits((arr) =>
      arr.map((h) => {
        if (h.id !== id) return h;

        const now = todayStr();
        const willBeDone = !h.done;
        let streak = h.streak;
        let lastDoneDate = h.lastDoneDate;
        let history = [...h.history];

        if (willBeDone) {
          if (isToday(h.lastDoneDate)) {
            // already counted today, nothing
          } else if (isYesterday(h.lastDoneDate)) {
            streak = h.streak + 1;
          } else {
            streak = 1;
          }
          lastDoneDate = now;
          if (!history.includes(now)) history.push(now);
          if (history.length > 28) history = history.slice(-28);
        } else {
          // uncheck — remove today's mark
          if (isToday(h.lastDoneDate)) {
            lastDoneDate = null;
            streak = isYesterday(h.lastDoneDate) ? h.streak : Math.max(0, h.streak - 1);
          }
          history = history.filter((d) => d !== now);
        }

        return { ...h, done: willBeDone, streak, lastDoneDate, history };
      })
    );
  }, []);

  const addNote = useCallback((id: string) => {
    const txt = (note[id] || "").trim();
    if (!txt) return;
    setHabits((arr) =>
      arr.map((h) =>
        h.id === id
          ? {
              ...h,
              notes: [
                ...h.notes,
                { id: `${Date.now()}`, text: txt, date: new Date().toISOString() },
              ],
            }
          : h
      )
    );
    setNote((m) => ({ ...m, [id]: "" }));
    Keyboard.dismiss();
  }, [note]);

  const addReminder = useCallback(
    async (id: string) => {
      const t = (timeText[id] || "").trim();
      const hm = parseTimeToHM(t);
      if (!hm) {
        Alert.alert("Use HH:MM (24h)", "Example: 08:00 or 14:30");
        return;
      }

      try {
        const notifId = await scheduleDaily(
          habits.find((h) => h.id === id)?.title || "Habit",
          habits.find((h) => h.id === id)?.title || "Habit",
          t
        );
        setHabits((arr) =>
          arr.map((h) => {
            if (h.id !== id) return h;
            const reminders = h.reminders.includes(t)
              ? h.reminders
              : [...h.reminders, t].sort();
            const notifMap = { ...(h.notifMap || {}), [t]: notifId };
            return { ...h, reminders, notifMap };
          })
        );
        setTimeText((m) => ({ ...m, [id]: "" }));
      } catch (e) {
        Alert.alert("Couldn’t schedule", String(e));
      }
    },
    [habits, timeText]
  );

  const removeReminder = useCallback(async (id: string, t: string) => {
    const habit = habits.find((h) => h.id === id);
    const notifId = habit?.notifMap?.[t];
    await cancelNotification(notifId);
    setHabits((arr) =>
      arr.map((h) => {
        if (h.id !== id) return h;
        const reminders = h.reminders.filter((x) => x !== t);
        const map = { ...(h.notifMap || {}) };
        delete map[t];
        return { ...h, reminders, notifMap: map };
      })
    );
  }, [habits]);

  const deleteHabit = useCallback(async (id: string) => {
    const habit = habits.find((h) => h.id === id);
    // cancel all its notifications
    if (habit?.notifMap) {
      await Promise.all(
        Object.values(habit.notifMap).map((nid) => cancelNotification(nid))
      );
    }
    setHabits((arr) => arr.filter((h) => h.id !== id));
  }, [habits]);

  // derived
  const weeklyDots = (h: Habit) => {
    const dots = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = ymd(d);
      dots.push(h.history.includes(iso));
    }
    return dots;
  };

  const badge = (streak: number) => {
    if (streak >= 30) return "🏆 Consistency King";
    if (streak >= 7) return "💪 One-Week Warrior";
    if (streak >= 3) return "✨ Getting Started";
    return "";
    // shows inline; we don’t persist badges
  };

  // renderers
  const renderHabit = ({ item }: { item: Habit }) => {
    const dots = weeklyDots(item);
    const b = badge(item.streak);

    return (
      <View style={s.card}>
        <View style={s.row}>
          <Pressable
            onPress={() => toggleDone(item.id)}
            style={[s.checkbox, item.done && s.checkboxOn]}
          />
          <Pressable onPress={() => toggleDone(item.id)} style={{ flex: 1 }}>
            <Text style={[s.title, item.done && s.done]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={s.sub}>
              🔥 {item.streak} day streak {b ? `• ${b}` : ""}
            </Text>
            <View style={s.dotsRow}>
              {dots.map((on, idx) => (
                <View
                  key={`${item.id}:dot:${idx}`}
                  style={[s.dot, on && s.dotOn]}
                />
              ))}
              <View style={[s.dot, item.done && s.dotOn]} />
            </View>
          </Pressable>

          <Pressable onPress={() => deleteHabit(item.id)} style={s.deleteBtn}>
            <Text style={s.deleteTxt}>Delete</Text>
          </Pressable>
        </View>

        {/* Notes */}
        <View style={s.noteRow}>
          <TextInput
            value={note[item.id] || ""}
            onChangeText={(v) =>
              setNote((m) => ({
                ...m,
                [item.id]: v,
              }))
            }
            placeholder="Add a quick note..."
            placeholderTextColor={THEME.sub}
            style={s.noteInput}
          />
          <Pressable onPress={() => addNote(item.id)} style={s.noteAdd}>
            <Text style={s.noteAddTxt}>Add</Text>
          </Pressable>
        </View>

        {/* Reminders: add */}
        <View style={s.remRow}>
          <TextInput
            value={timeText[item.id] || ""}
            onChangeText={(v) =>
              setTimeText((m) => ({
                ...m,
                [item.id]: v,
              }))
            }
            placeholder="HH:MM"
            placeholderTextColor={THEME.sub}
            style={s.timeInput}
            keyboardType="number-pad"
            maxLength={5}
          />
          <Pressable onPress={() => addReminder(item.id)} style={s.timeSet}>
            <Text style={s.noteAddTxt}>Set</Text>
          </Pressable>

          {/* existing time chips */}
          <View style={s.chipsRow}>
            {item.reminders.map((t) => (
              <View key={`${item.id}:time:${t}`} style={s.chip}>
                <Text style={s.chipTxt}>⏰ {t}</Text>
                <Pressable
                  onPress={() => removeReminder(item.id, t)}
                  hitSlop={8}
                >
                  <Text style={s.chipX}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      {/* progress */}
      <View style={s.barWrap}>
        <View style={[s.barFill, { width: `${Math.round(progress * 100)}%` }]} />
        <Text style={s.barPct}>{Math.round(progress * 100)}%</Text>
      </View>

      <Text style={s.quote}>"{quote}"</Text>

      {/* add habit */}
      <TextInput
        placeholder="Enter a new habit"
        placeholderTextColor={THEME.sub}
        value={text}
        onChangeText={setText}
        onSubmitEditing={addHabit}
        style={s.input}
      />
      <Pressable onPress={addHabit} style={s.addBtn}>
        <Text style={s.addTxt}>Add Habit</Text>
      </Pressable>

      <FlatList
        data={habits}
        keyExtractor={(h) => h.id}
        renderItem={renderHabit}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          <Text style={s.empty}>Add a habit to get started.</Text>
        }
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

// ---------- styles ----------
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg, padding: 16 },
  input: {
    backgroundColor: THEME.input,
    borderWidth: 1,
    borderColor: THEME.border,
    color: THEME.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  addBtn: {
    backgroundColor: THEME.accentDim,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
    marginBottom: 8,
  },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },

  quote: { color: THEME.sub, marginTop: 6, marginBottom: 6 },

  card: {
    backgroundColor: THEME.card,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  row: { flexDirection: "row", alignItems: "center" },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: "#0b1722",
    marginRight: 12,
  },
  checkboxOn: { backgroundColor: THEME.accent },
  title: { color: THEME.text, fontSize: 18, fontWeight: "600" },
  done: { textDecorationLine: "line-through", color: "#9FE8B5" },
  sub: { color: THEME.sub, marginTop: 4 },
  dotsRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22303d",
  },
  dotOn: { backgroundColor: THEME.accent },

  deleteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#3b0f12",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    marginLeft: 10,
  },
  deleteTxt: { color: "#fecaca", fontWeight: "700" },

  noteRow: { flexDirection: "row", marginTop: 12, gap: 8 },
  noteInput: {
    flex: 1,
    backgroundColor: THEME.input,
    borderWidth: 1,
    borderColor: THEME.border,
    color: THEME.text,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  noteAdd: {
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e293b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  noteAddTxt: { color: THEME.text, fontWeight: "700" },

  remRow: { marginTop: 10 },
  timeInput: {
    width: 100,
    backgroundColor: THEME.input,
    borderWidth: 1,
    borderColor: THEME.border,
    color: THEME.text,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  timeSet: {
    position: "absolute",
    left: 112,
    top: 0,
    height: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e293b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    paddingRight: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: THEME.chip,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipTxt: { color: THEME.text },
  chipX: { color: "#fca5a5", fontSize: 16, marginLeft: 2 },

  barWrap: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#1f2937",
    overflow: "hidden",
    marginTop: 8,
  },
  barFill: { height: 10, backgroundColor: THEME.accent },
  barPct: {
    color: THEME.sub,
    alignSelf: "flex-end",
    marginTop: 4,
    marginBottom: 6,
    fontSize: 12,
  },

  empty: { color: THEME.sub, marginTop: 24, textAlign: "center" },
});
