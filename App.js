import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  AppState,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import DateTimePicker from "@react-native-community/datetimepicker";

//////////////////////////
// Minimal theming
//////////////////////////
const COLORS = {
  bg: "#0B0F14",
  card: "#121822",
  text: "#E9EEF5",
  sub: "#AAB6C5",
  accent: "#5EE1A0",
  accentDim: "#2C7C5C",
  danger: "#FF6B6B",
  border: "#1F2937",
  yellow: "#FBBF24",
  chip: "#0F1520",
};

const SPACING = 14;
const RADIUS = 12;

//////////////////////////
// Helpers
//////////////////////////
const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const lastNDates = (n) => {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setDate(d.getDate() - i);
    out.push(dd.toISOString().slice(0, 10));
  }
  return out;
};

const minsToHHMM = (mins) => {
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${pad(hh)}:${pad(mm)}`;
};

const hhmmToMins = (date) => date.getHours() * 60 + date.getMinutes();

const QUOTES = [
  "Small daily wins stack into big results.",
  "You don’t need more time, just more focus.",
  "Consistency beats intensity.",
  "Do it for your future self.",
  "Tiny actions. Massive outcomes.",
];

//////////////////////////
// Storage Keys
//////////////////////////
const STORE_KEY = "microhabit:v2:data";
const STORE_DATE = "microhabit:lastDate";

//////////////////////////
// Default data
//////////////////////////
const defaultHabits = [
  {
    id: "h1",
    name: "Drink Water",
    times: [10 * 60, 14 * 60, 18 * 60], // minutes since midnight
    notes: "",
    history: {},
    notifications: [],
  },
  {
    id: "h2",
    name: "Eat a Healthy Meal",
    times: [12 * 60 + 30],
    notes: "",
    history: {},
    notifications: [],
  },
  {
    id: "h3",
    name: "Laundry (Daily Tidy)",
    times: [20 * 60],
    notes: "",
    history: {},
    notifications: [],
  },
];

//////////////////////////
// Notifications setup
//////////////////////////
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function askNotificationPerms() {
  if (Platform.OS === "web") return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const { status: status2 } = await Notifications.requestPermissionsAsync();
    return status2 === "granted";
  }
  return true;
}

async function scheduleForDate(date, title, body) {
  if (Platform.OS === "web") return null;
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: date,
  });
  return id;
}

//////////////////////////
// Main App
//////////////////////////
export default function App() {
  const [habits, setHabits] = useState(defaultHabits);
  const [newName, setNewName] = useState("");

  // time picker state for the "Add Habit" creator
  const [showPicker, setShowPicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());
  const [newTimes, setNewTimes] = useState([]); // minutes since midnight

  // time picker state for editing an existing habit
  const [editPickerForId, setEditPickerForId] = useState(null);

  const appState = useRef(AppState.currentState);
  const [ready, setReady] = useState(false);
  const [quoteIdx, setQuoteIdx] = useState(0);

  // rotate quote by day
  useEffect(() => {
    const dayIndex =
      Math.floor(new Date().getTime() / (24 * 3600 * 1000)) % QUOTES.length;
    setQuoteIdx(dayIndex);
  }, []);

  // Load
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        const lastDate = await AsyncStorage.getItem(STORE_DATE);
        if (raw) {
          setHabits(JSON.parse(raw));
        }
        if (lastDate && lastDate !== todayKey()) resetTodayOnLoad();
        await AsyncStorage.setItem(STORE_DATE, todayKey());
      } catch (e) {
        console.log("Load error", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Persist
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(habits)).catch(() => {});
  }, [habits, ready]);

  // Daily reset when app returns to foreground on new day
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (appState.current.match(/inactive|background/) && state === "active") {
        const last = await AsyncStorage.getItem(STORE_DATE);
        const today = todayKey();
        if (last !== today) {
          await AsyncStorage.setItem(STORE_DATE, today);
          resetTodayOnLoad();
        }
      }
      appState.current = state;
    });
    return () => sub.remove();
  }, [habits]);

  function resetTodayOnLoad() {
    setHabits((prev) =>
      prev.map((h) => ({
        ...h,
        notifications: [],
        history: { ...h.history, [todayKey()]: false },
      }))
    );
  }

  // Basic stats
  const isTodayDone = (h) => !!h.history[todayKey()];
  const setTodayDone = (id, val) => {
    setHabits((prev) =>
      prev.map((h) =>
        h.id === id
          ? { ...h, history: { ...h.history, [todayKey()]: !!val } }
          : h
      )
    );
  };
  const progressPct = (h) => (isTodayDone(h) ? 1 : 0);
  const weekKeys = lastNDates(7);

  // Streaks + badges
  const streakOf = (h) => {
    let count = 0;
    const days = lastNDates(60);
    for (let i = days.length - 1; i >= 0; i--) {
      const k = days[i];
      const done = !!h.history[k];
      if (done) count++;
      else if (k === todayKey()) break;
      else count = 0;
    }
    return count;
  };
  const longestStreakOf = (h) => {
    let best = 0,
      run = 0;
    const days = lastNDates(120);
    for (const k of days) {
      if (h.history[k]) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    return best;
  };
  const badgeFor = (h) => {
    const s = longestStreakOf(h);
    if (s >= 30) return "🏆 Consistency King (30)";
    if (s >= 7) return "🥇 One Week Warrior (7)";
    if (s >= 3) return "🎯 Getting Started (3)";
    return null;
  };

  // Notifications
  const scheduleTodayReminders = async (habit) => {
    const granted = await askNotificationPerms();
    if (!granted) {
      Alert.alert("Notifications", "Permission not granted.");
      return;
    }
    const now = new Date();
    const ids = [];
    for (const mins of habit.times) {
      const target = new Date();
      target.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
      const id = await scheduleForDate(
        target,
        habit.name,
        "Time to keep your streak alive ✨"
      );
      if (id) ids.push(id);
    }
    setHabits((prev) =>
      prev.map((h) => (h.id === habit.id ? { ...h, notifications: ids } : h))
    );
    Alert.alert(
      "Reminders scheduled",
      `Set for ${habit.times.map(minsToHHMM).join(", ")}`
    );
  };

  const cancelReminders = async (habit) => {
    if (Platform.OS !== "web") {
      for (const id of habit.notifications || []) {
        try {
          await Notifications.cancelScheduledNotificationAsync(id);
        } catch {}
      }
    }
    setHabits((prev) =>
      prev.map((h) => (h.id === habit.id ? { ...h, notifications: [] } : h))
    );
  };

  // Creator: add time via picker
  const onAddTimeFromPicker = (event, date) => {
    // Android calls with event.type === 'dismissed' if canceled
    if (Platform.OS === "android") setShowPicker(false);
    if (!date) return;
    const mins = hhmmToMins(date);
    setNewTimes((prev) =>
      prev.includes(mins) ? prev : [...prev, mins].sort((a, b) => a - b)
    );
    if (Platform.OS === "ios") {
      // keep picker open on iOS; user taps "Add time" again if needed
    }
  };

  const addHabit = () => {
    const h = {
      id: "h" + Math.random().toString(36).slice(2),
      name: (newName || "New Habit").trim(),
      times: newTimes,
      notes: "",
      history: { [todayKey()]: false },
      notifications: [],
    };
    setHabits((prev) => [h, ...prev]);
    setNewName("");
    setNewTimes([]);
  };

  const deleteHabit = (id) => {
    Alert.alert("Delete habit?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => setHabits((prev) => prev.filter((x) => x.id !== id)),
      },
    ]);
  };

  // Editing existing habit times
  const addTimeToHabit = (habitId, date) => {
    if (!date) return setEditPickerForId(null);
    const mins = hhmmToMins(date);
    setHabits((prev) =>
      prev.map((h) =>
        h.id === habitId
          ? {
              ...h,
              times: h.times.includes(mins)
                ? h.times
                : [...h.times, mins].sort((a, b) => a - b),
            }
          : h
      )
    );
    setEditPickerForId(null);
  };

  const removeTimeFromHabit = (habitId, mins) => {
    setHabits((prev) =>
      prev.map((h) =>
        h.id === habitId
          ? { ...h, times: h.times.filter((m) => m !== mins) }
          : h
      )
    );
  };

  const quote = QUOTES[quoteIdx];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ padding: SPACING }}>
        {/* Header / Quote */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: RADIUS,
            padding: SPACING,
            borderWidth: 1,
            borderColor: COLORS.border,
            marginBottom: SPACING,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "700" }}>
            Micro Habit
          </Text>
          <Text style={{ color: COLORS.sub, marginTop: 6 }}>{quote}</Text>
          <Text style={{ color: COLORS.sub, marginTop: 6, fontSize: 12 }}>
            {todayKey()}
          </Text>
        </View>

        {/* Add Habit */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: RADIUS,
            padding: SPACING,
            borderWidth: 1,
            borderColor: COLORS.border,
            marginBottom: SPACING,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "700", marginBottom: 8 }}>
            Add a habit
          </Text>

          <TextInput
            placeholder="Habit name (e.g., Drink Water)"
            placeholderTextColor={COLORS.sub}
            value={newName}
            onChangeText={setNewName}
            style={{
              color: COLORS.text,
              backgroundColor: COLORS.chip,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: COLORS.border,
              marginBottom: 10,
            }}
          />

          {/* Selected times as chips */}
          {newTimes.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {newTimes.map((m) => (
                <TimeChip key={m} label={minsToHHMM(m)} onPress={() => setNewTimes((prev) => prev.filter((x) => x !== m))} />
              ))}
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button title="Add time" onPress={() => setShowPicker(true)} />
            <Button title="Add habit" onPress={addHabit} />
          </View>

          {/* Creator time picker */}
          {showPicker && (
            <DateTimePicker
              value={pickerDate}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(e, d) => onAddTimeFromPicker(e, d)}
            />
          )}
        </View>

        {/* Habits List */}
        <FlatList
          data={habits}
          keyExtractor={(h) => h.id}
          scrollEnabled={false}
          renderItem={({ item: h }) => {
            const done = isTodayDone(h);
            const pct = progressPct(h);
            const streak = streakOf(h);
            const badge = badgeFor(h);

            return (
              <View
                style={{
                  backgroundColor: COLORS.card,
                  borderRadius: RADIUS,
                  padding: SPACING,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  marginBottom: SPACING,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "700", flex: 1 }}>
                    {h.name}
                  </Text>
                  <TouchableOpacity onPress={() => deleteHabit(h.id)}>
                    <Text style={{ color: COLORS.danger }}>Delete</Text>
                  </TouchableOpacity>
                </View>

                {/* Times */}
                <Text style={{ color: COLORS.sub, marginTop: 6 }}>Reminders:</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  {h.times.length === 0 && (
                    <Text style={{ color: COLORS.sub }}>None</Text>
                  )}
                  {h.times.map((m) => (
                    <TimeChip key={m} label={minsToHHMM(m)} onPress={() => removeTimeFromHabit(h.id, m)} />
                  ))}
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <Button title="Add time" onPress={() => setEditPickerForId(h.id)} />
                  <Button
                    title={done ? "Mark Un-done" : "Mark Done"}
                    onPress={() => setTodayDone(h.id, !done)}
                  />
                </View>

                {/* Progress bar */}
                <View
                  style={{
                    height: 10,
                    backgroundColor: COLORS.chip,
                    borderRadius: 999,
                    overflow: "hidden",
                    marginTop: 12,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round(pct * 100)}%`,
                      height: "100%",
                      backgroundColor: COLORS.accent,
                    }}
                  />
                </View>
                <Text style={{ color: COLORS.sub, fontSize: 12, marginTop: 6 }}>
                  {done ? "Completed 1/1" : "Completed 0/1"}
                </Text>

                {/* Streak + badge */}
                <Text style={{ color: COLORS.text, marginTop: 8 }}>
                  Streak: {streak} day{streak === 1 ? "" : "s"}
                </Text>
                {badge && <Text style={{ color: COLORS.yellow, marginTop: 4 }}>{badge}</Text>}

                {/* Weekly mini-calendar */}
                <View style={{ flexDirection: "row", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                  {weekKeys.map((k) => {
                    const v = !!h.history[k];
                    return (
                      <View
                        key={k + h.id}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: v ? COLORS.accentDim : COLORS.chip,
                          borderWidth: 1,
                          borderColor: COLORS.border,
                        }}
                      >
                        <Text style={{ color: COLORS.text, fontSize: 14 }}>{v ? "✅" : "❌"}</Text>
                      </View>
                    );
                  })}
                </View>

                {/* Notes */}
                <Text style={{ color: COLORS.sub, marginTop: 12, marginBottom: 6 }}>Notes</Text>
                <TextInput
                  placeholder="Quick reflection (e.g., felt great today)"
                  placeholderTextColor={COLORS.sub}
                  value={h.notes}
                  onChangeText={(t) =>
                    setHabits((prev) =>
                      prev.map((x) => (x.id === h.id ? { ...x, notes: t } : x))
                    )
                  }
                  style={{
                    color: COLORS.text,
                    backgroundColor: COLORS.chip,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                />

                {/* Reminder actions */}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <Button title="Schedule reminders" onPress={() => scheduleTodayReminders(h)} />
                  <Button title="Cancel reminders" onPress={() => cancelReminders(h)} />
                </View>

                {/* Inline picker for editing an existing habit */}
                {editPickerForId === h.id && (
                  <View style={{ marginTop: 10 }}>
                    <DateTimePicker
                      value={new Date()}
                      mode="time"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(e, d) => {
                        if (Platform.OS === "android") setEditPickerForId(null);
                        if (d) addTimeToHabit(h.id, d);
                      }}
                    />
                    {Platform.OS === "ios" && (
                      <Text style={{ color: COLORS.sub, marginTop: 6 }}>
                        Pick a time above, then tap outside to close.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

//////////////////////////
// Reusable components
//////////////////////////
function Button({ title, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: COLORS.accent,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
      }}
    >
      <Text style={{ color: "#052216", fontWeight: "700" }}>{title}</Text>
    </TouchableOpacity>
  );
}

function TimeChip({ label, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: COLORS.chip,
        borderColor: COLORS.border,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: COLORS.text }}>{label}  ❌</Text>
    </TouchableOpacity>
  );
}