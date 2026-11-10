// A page as a native Android app, no webview (C199c, NATIVE-APPS.md):
// `ters build-native-app`. The program is C (compiler/src/c.ts, `page:
// "ui"`): its page mounted, styled and laid out in C (c-layout.ts) on a
// screen that JNI_C hands to the app's Java side, which places Android
// views where it's told (MainActivity.java). The folder is a
// Gradle project; `gradle assembleDebug` in it builds the APK (the
// "Android app" workflow does, since containers can't reach the SDK).

import { createHash } from "node:crypto";
import { icon, rgb } from "./app.ts";

export const PACKAGE = "app.ters.page";

// The app's own id on the phone, one per program, so apps don't replace
// each other (the Java package stays PACKAGE, which the JNI names hang on).
export const nativeAppId = (title: string) => `app.ters.${title.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^(\d)/, "_$1") || "page"}`;

// The project, as paths and contents. `c` is the page's C.
export function nativeAppFolder(title: string, c: string): Record<string, string | Uint8Array> {
  const hue = parseInt(createHash("sha256").update(title).digest("hex").slice(0, 4), 16) % 360;
  const dir = PACKAGE.replace(/\./g, "/");
  return {
    "settings.gradle": `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name = ${JSON.stringify(title)}\ninclude ":app"\n`,
    "build.gradle": `plugins { id "com.android.application" version "8.7.3" apply false }\n`,
    "gradle.properties": "android.useAndroidX=false\norg.gradle.jvmargs=-Xmx2g\n",
    "app/build.gradle": `plugins { id "com.android.application" }
android {
  namespace "${PACKAGE}"
  compileSdk 35
  // TERS_VERSION_CODE: each build numbered higher (the "Android app"
  // workflow gives its run number), so a new build installs over the old.
  defaultConfig { applicationId "${nativeAppId(title)}"; minSdk 24; targetSdk 35; versionCode((System.getenv("TERS_VERSION_CODE") ?: "1").toInteger()); versionName "1" }
  compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }
  externalNativeBuild { cmake { path "src/main/cpp/CMakeLists.txt" } }
}
`,
    "app/src/main/AndroidManifest.xml": `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label="${xml(title)}" android:icon="@mipmap/ic_launcher">
    <activity android:name=".MainActivity" android:exported="true" android:windowSoftInputMode="adjustResize" android:configChanges="uiMode|orientation|screenSize|screenLayout|smallestScreenSize">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`,
    "app/src/main/res/mipmap/ic_launcher.png": icon(192, rgb(hue, 0.45, 0.42)),
    "app/src/main/cpp/CMakeLists.txt": `cmake_minimum_required(VERSION 3.22)
project(page C)
set(CMAKE_C_STANDARD 11)
# The evaluator's numbers, as ters native builds them (compiler/src/c.ts CFLAGS).
set(CMAKE_C_FLAGS "\${CMAKE_C_FLAGS} -O2 -ffp-contract=off -fwrapv")
add_library(page SHARED page.c)
target_link_libraries(page m)
`,
    "app/src/main/cpp/page.c": `${c}\n${JNI_C}`,
    [`app/src/main/java/${dir}/MainActivity.java`]: ACTIVITY,
    "README.md": `# ${title}, as a native Android app

Made by \`ters build-native-app\` (NATIVE-APPS.md, C199c): the program is
C (app/src/main/cpp/page.c), which also styles and lays out its page,
and the page is Android's own views, with no webview. Build the debug APK with \`gradle assembleDebug\` here (Android
SDK and NDK installed); it is app/build/outputs/apk/debug/app-debug.apk.
`,
  };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// The screen over JNI (C199d): each of ters_ui's calls (compiler/src/
// c-layout.ts) is a call of MainActivity's method of that name, on the UI
// thread, with views named by numbers from 1. Texts cross as UTF-16, so
// any character does; colours as ARGB ints; places and sizes in dp.
export const JNI_C = String.raw`
// The screen over JNI (C199d): MainActivity's views, by number.
#include <jni.h>
static JNIEnv *ters_j;
static jobject ters_a;
static jmethodID ters_jm[14];
static jstring ters_js(const char *s, size_t n) {
  jchar *u = malloc(sizeof *u * (n + 1));
  size_t k = 0;
  for (size_t i = 0; i < n;) {
    unsigned char b = (unsigned char)s[i];
    uint32_t c; int more;
    if (b < 0x80) { c = b; more = 0; } else if (b >> 5 == 6) { c = b & 31; more = 1; } else if (b >> 4 == 14) { c = b & 15; more = 2; } else { c = b & 7; more = 3; }
    i++;
    while (more-- && i < n) c = c << 6 | ((unsigned char)s[i++] & 63);
    if (c >= 0x10000) { c -= 0x10000; u[k++] = (jchar)(0xD800 | c >> 10); u[k++] = (jchar)(0xDC00 | (c & 0x3FF)); } else u[k++] = (jchar)c;
  }
  jstring r = (*ters_j)->NewString(ters_j, u, (jsize)k);
  free(u);
  return r;
}
static void *ters_view_of(jint id) { return (void *)(intptr_t)id; }
static jint ters_id(void *v) { return (jint)(intptr_t)v; }
#define TERS_J(i, ...) (*ters_j)->CallVoidMethod(ters_j, ters_a, ters_jm[i], __VA_ARGS__)
static void *j_box(void *c, const char *tag, size_t n) { (void)c; jstring t = ters_js(tag, n); jint r = (*ters_j)->CallIntMethod(ters_j, ters_a, ters_jm[0], t); (*ters_j)->DeleteLocalRef(ters_j, t); return ters_view_of(r); }
static void *j_text(void *c, const char *s, size_t n) { (void)c; jstring t = ters_js(s, n); jint r = (*ters_j)->CallIntMethod(ters_j, ters_a, ters_jm[1], t); (*ters_j)->DeleteLocalRef(ters_j, t); return ters_view_of(r); }
static void j_set_text(void *c, void *v, const char *s, size_t n) { (void)c; jstring t = ters_js(s, n); TERS_J(2, ters_id(v), t); (*ters_j)->DeleteLocalRef(ters_j, t); }
static void j_set_value(void *c, void *v, const char *s, size_t n) { (void)c; jstring t = ters_js(s, n); TERS_J(3, ters_id(v), t); (*ters_j)->DeleteLocalRef(ters_j, t); }
static void j_append(void *c, void *p, void *k) { (void)c; TERS_J(4, ters_id(p), ters_id(k)); }
static void j_clear(void *c, void *p) { (void)c; TERS_J(5, ters_id(p)); }
static void j_listen(void *c, void *v, const char *e, size_t n, int h) { (void)c; jstring t = ters_js(e, n); TERS_J(6, ters_id(v), t, (jint)h); (*ters_j)->DeleteLocalRef(ters_j, t); }
static void j_gone(void *c, void *v) { (void)c; TERS_J(7, ters_id(v)); }
static void j_place(void *c, void *v, double x, double y, double w, double h, int shown) { (void)c; TERS_J(8, ters_id(v), x, y, w, h, (jint)shown); }
static void j_paint(void *c, void *v, uint32_t bg, double radius, double border, uint32_t bc) { (void)c; TERS_J(9, ters_id(v), (jint)bg, radius, border, (jint)bc); }
static void j_font(void *c, void *v, double size, int bold, uint32_t color, int align, double line) { (void)c; TERS_J(10, ters_id(v), size, (jint)bold, (jint)color, (jint)align, line); }
static void j_measure(void *c, const char *s, size_t n, double size, int bold, double width, double *w, int *lines) {
  (void)c;
  jstring t = ters_js(s, n);
  jdoubleArray r = (*ters_j)->CallObjectMethod(ters_j, ters_a, ters_jm[11], t, size, (jint)bold, width);
  jdouble x[2] = { 0, 1 };
  if (r) { (*ters_j)->GetDoubleArrayRegion(ters_j, r, 0, 2, x); (*ters_j)->DeleteLocalRef(ters_j, r); }
  (*ters_j)->DeleteLocalRef(ters_j, t);
  *w = x[0]; *lines = (int)x[1];
}
static void j_page(void *c, double w, double h, uint32_t bg) { (void)c; TERS_J(12, w, h, (jint)bg); }
static void j_draw(void *c, void *v, const double *ops, size_t n) {
  (void)c;
  jdoubleArray a = (*ters_j)->NewDoubleArray(ters_j, (jsize)n);
  (*ters_j)->SetDoubleArrayRegion(ters_j, a, 0, (jsize)n, ops);
  TERS_J(13, ters_id(v), a);
  (*ters_j)->DeleteLocalRef(ters_j, a);
}
static ters_ui ters_jui = { 0, j_box, j_text, j_set_text, j_set_value, j_append, j_clear, j_listen, j_gone, j_place, j_paint, j_font, j_measure, j_page, j_draw };
// The page on a screen width dp wide, dark or not: its root's number, 0
// when main has no answer.
JNIEXPORT jint JNICALL Java_app_ters_page_MainActivity_nativeStart(JNIEnv *env, jobject self, jdouble width, jint dark) {
  ters_j = env;
  ters_a = (*env)->NewGlobalRef(env, self);
  jclass k = (*env)->GetObjectClass(env, self);
  const char *ms[14][2] = { { "box", "(Ljava/lang/String;)I" }, { "text", "(Ljava/lang/String;)I" }, { "setText", "(ILjava/lang/String;)V" }, { "setValue", "(ILjava/lang/String;)V" }, { "append", "(II)V" }, { "clear", "(I)V" }, { "listen", "(ILjava/lang/String;I)V" }, { "gone", "(I)V" }, { "place", "(IDDDDI)V" }, { "paint", "(IIDDI)V" }, { "font", "(IDIIID)V" }, { "measure", "(Ljava/lang/String;DID)[D" }, { "page", "(DDI)V" }, { "draw", "(I[D)V" } };
  for (int i = 0; i < 14; i++) ters_jm[i] = (*env)->GetMethodID(env, k, ms[i][0], ms[i][1]);
  return ters_id(ters_ui_start(&ters_jui, width, dark));
}
// The screen's width or colour scheme changed.
JNIEXPORT void JNICALL Java_app_ters_page_MainActivity_nativeResize(JNIEnv *env, jobject self, jdouble width, jint dark) { (void)self; ters_j = env; ters_ui_resize(width, dark); }
static void ters_utf8(JNIEnv *env, jstring s, char **out, size_t *n) {
  const jchar *u = (*env)->GetStringChars(env, s, 0);
  jsize m = (*env)->GetStringLength(env, s);
  char *b = malloc((size_t)m * 3 + 1);
  size_t k = 0;
  for (jsize i = 0; i < m; i++) {
    uint32_t c = u[i];
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < m && u[i + 1] >= 0xDC00 && u[i + 1] < 0xE000) c = 0x10000 + ((c - 0xD800) << 10) + (u[++i] - 0xDC00);
    if (c < 0x80) b[k++] = (char)c;
    else if (c < 0x800) { b[k++] = (char)(0xC0 | c >> 6); b[k++] = (char)(0x80 | (c & 63)); }
    else if (c < 0x10000) { b[k++] = (char)(0xE0 | c >> 12); b[k++] = (char)(0x80 | (c >> 6 & 63)); b[k++] = (char)(0x80 | (c & 63)); }
    else { b[k++] = (char)(0xF0 | c >> 18); b[k++] = (char)(0x80 | (c >> 12 & 63)); b[k++] = (char)(0x80 | (c >> 6 & 63)); b[k++] = (char)(0x80 | (c & 63)); }
  }
  (*env)->ReleaseStringChars(env, s, u);
  *out = b; *n = k;
}
// A finger on a picture (C199f), in dp from its top left: kind 0 down, 1
// move, 2 up, 3 cancelled. Whether the page listened.
JNIEXPORT jint JNICALL Java_app_ters_page_MainActivity_nativePointer(JNIEnv *env, jobject self, jint id, jint kind, jdouble x, jdouble y) { (void)self; ters_j = env; return ters_ui_pointer(ters_view_of(id), kind, x, y); }
JNIEXPORT jint JNICALL Java_app_ters_page_MainActivity_nativeClock(JNIEnv *env, jobject self) { (void)env; (void)self; return ters_page_clock(); }
JNIEXPORT jint JNICALL Java_app_ters_page_MainActivity_nativeFrame(JNIEnv *env, jobject self) { (void)self; ters_j = env; return ters_page_frame(); }
JNIEXPORT jint JNICALL Java_app_ters_page_MainActivity_nativeEvent(JNIEnv *env, jobject self, jint h, jstring value, jstring key, jdouble x, jdouble y, jdouble seconds) {
  (void)self;
  ters_j = env;
  char *v, *k; size_t vn, kn;
  ters_utf8(env, value, &v, &vn); ters_utf8(env, key, &k, &kn);
  int r = ters_page_event(h, v, vn, k, kn, x, y, seconds);
  free(v); free(k);
  return r;
}
`;

// The Android side (C199d): boxes and texts placed where the page's
// layout (compiler/src/c-layout.ts, in C) puts them, painted and in the
// fonts it gives, in dp; texts measured by Android's own text layout.
const ACTIVITY = `package ${PACKAGE};

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextWatcher;
import android.util.Log;
import android.util.TypedValue;
import android.view.Choreographer;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.HashMap;

// The page: made and laid out in C (libpage.so) and drawn with this
// activity's views, which C asks for by the methods below.
public class MainActivity extends Activity {
  static { System.loadLibrary("page"); }
  native int nativeStart(double width, int dark);
  native void nativeResize(double width, int dark);
  native int nativeEvent(int handler, String value, String key, double x, double y, double seconds);
  // Whether what the page shows read the clock, and a frame that shows it
  // again (whether it still reads it).
  native int nativePointer(int picture, int kind, double x, double y);
  native int nativeClock();
  native int nativeFrame();

  private final HashMap<Integer, View> views = new HashMap<>();
  private int next = 1;
  // A value C sets isn't a person typing it.
  private boolean quiet;
  private float density;
  private ScrollView scroll;
  private FrameLayout page;
  private double width;
  private int dark;

  @Override protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    density = getResources().getDisplayMetrics().density;
    scroll = new ScrollView(this);
    page = new FrameLayout(this);
    page.setClipChildren(false);
    scroll.addView(page, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    width = getResources().getDisplayMetrics().widthPixels / density;
    dark = darkMode(getResources().getConfiguration());
    View root = views.get(nativeStart(width, dark));
    if (root != null) page.addView(root);
    else { TextView t = new TextView(this); t.setText("This page has no answer to draw."); page.addView(t); }
    // Below the status bar and above the navigation bar, which Android 15
    // draws the page under (edge to edge); the page as wide as what's left.
    scroll.setOnApplyWindowInsetsListener((v, insets) -> {
      int l, t, r, b;
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets x = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        l = x.left; t = x.top; r = x.right; b = x.bottom;
      } else { l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop(); r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom(); }
      v.setPadding(l, t, r, b);
      resize((getResources().getDisplayMetrics().widthPixels - l - r) / density, dark);
      return insets;
    });
    setContentView(scroll);
    tick();
  }

  @Override public void onConfigurationChanged(Configuration c) {
    super.onConfigurationChanged(c);
    resize(getResources().getDisplayMetrics().widthPixels / density, darkMode(c));
    scroll.requestApplyInsets();
  }

  private static int darkMode(Configuration c) { return (c.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES ? 1 : 0; }

  private void resize(double w, int d) {
    if (Math.abs(w - width) < 0.5 && d == dark) return;
    width = w; dark = d;
    nativeResize(w, d);
  }

  // While what the page shows reads the clock, it runs again each frame,
  // as a browser page does.
  private boolean ticking;
  private void tick() {
    if (ticking || nativeClock() == 0) return;
    ticking = true;
    final long from = System.nanoTime();
    Choreographer.getInstance().postFrameCallback(new Choreographer.FrameCallback() {
      int n;
      public void doFrame(long nanos) {
        n++;
        if (nativeFrame() != 0) Choreographer.getInstance().postFrameCallback(this);
        else { ticking = false; Log.d("ters", "frames: " + n + " in " + (System.nanoTime() - from) / 1000000 + " ms"); }
      }
    });
  }

  private int put(View v) { int id = next++; views.put(id, v); return id; }
  private int px(double dp) { return (int) Math.round(dp * density); }

  int box(String tag) {
    View v;
    if (tag.equals("input") || tag.equals("textarea")) {
      EditText e = new EditText(this);
      e.setSingleLine(tag.equals("input"));
      e.setBackground(null);
      e.setPadding(px(2), 0, px(2), 0);
      e.setIncludeFontPadding(false);
      v = e;
    } else if (tag.equals("svg")) {
      Picture p = new Picture(this, density);
      p.id = next;
      v = p;
    } else {
      FrameLayout f = new FrameLayout(this);
      f.setClipChildren(false);
      f.setClipToPadding(false);
      v = f;
    }
    return put(v);
  }

  int text(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setIncludeFontPadding(false);
    t.setPadding(0, 0, 0, 0);
    return put(t);
  }

  void setText(int id, String s) { View v = views.get(id); if (v instanceof TextView) ((TextView) v).setText(s); }

  void setValue(int id, String value) {
    View v = views.get(id);
    if (!(v instanceof EditText)) return;
    EditText e = (EditText) v;
    if (!e.getText().toString().equals(value)) { quiet = true; e.setText(value); e.setSelection(value.length()); quiet = false; }
  }

  void append(int parent, int kid) {
    View p = views.get(parent), k = views.get(kid);
    if (!(p instanceof ViewGroup) || k == null) return;
    if (k.getParent() instanceof ViewGroup) ((ViewGroup) k.getParent()).removeView(k);
    ((ViewGroup) p).addView(k, new FrameLayout.LayoutParams(0, 0));
  }

  void clear(int id) { View v = views.get(id); if (v instanceof ViewGroup) ((ViewGroup) v).removeAllViews(); }

  void gone(int id) { views.remove(id); }

  void place(int id, double x, double y, double w, double h, int shown) {
    View v = views.get(id);
    if (v == null) return;
    v.setVisibility(shown != 0 ? View.VISIBLE : View.GONE);
    // Each edge rounded, so boxes side by side meet.
    ViewGroup.LayoutParams g = v.getLayoutParams();
    FrameLayout.LayoutParams p = g instanceof FrameLayout.LayoutParams ? (FrameLayout.LayoutParams) g : new FrameLayout.LayoutParams(0, 0);
    p.leftMargin = px(x); p.topMargin = px(y);
    p.width = px(x + w) - px(x); p.height = px(y + h) - px(y);
    p.gravity = Gravity.TOP | Gravity.START;
    v.setLayoutParams(p);
  }

  void paint(int id, int bg, double radius, double border, int borderColour) {
    View v = views.get(id);
    if (v == null || v instanceof TextView && !(v instanceof EditText)) return;
    if (bg == 0 && border == 0) { v.setBackground(null); return; }
    GradientDrawable d = new GradientDrawable();
    d.setColor(bg);
    d.setCornerRadius((float) (radius * density));
    if (border > 0) d.setStroke(Math.max(1, px(border)), borderColour);
    v.setBackground(d);
  }

  private final TextPaint paint = new TextPaint(TextPaint.ANTI_ALIAS_FLAG);

  void font(int id, double size, int bold, int colour, int align, double line) {
    View v = views.get(id);
    if (!(v instanceof TextView)) return;
    TextView t = (TextView) v;
    t.setTextSize(TypedValue.COMPLEX_UNIT_PX, (float) (size * density));
    t.setTypeface(bold != 0 ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
    t.setTextColor(colour);
    t.setGravity((align == 1 ? Gravity.CENTER_HORIZONTAL : align == 2 ? Gravity.END : Gravity.START) | Gravity.TOP);
    // A line line dp high, its text in the middle (CSS's half leading).
    int font = t.getPaint().getFontMetricsInt(null), lead = Math.max(0, px(line) - font);
    t.setLineSpacing(lead, 1f);
    if (!(v instanceof EditText)) t.setPadding(0, lead / 2, 0, 0);
  }

  // A text's width in dp and its number of lines, wrapped at width dp.
  double[] measure(String s, double size, int bold, double width) {
    paint.setTextSize((float) (size * density));
    paint.setTypeface(bold != 0 ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
    float one = paint.measureText(s);
    int w = (int) Math.ceil(width * density);
    if (one <= w || w <= 0) return new double[] { one / density, 1 };
    StaticLayout l = Build.VERSION.SDK_INT >= 23 ? StaticLayout.Builder.obtain(s, 0, s.length(), paint, w).setIncludePad(false).build() : new StaticLayout(s, paint, w, Layout.Alignment.ALIGN_NORMAL, 1f, 0f, false);
    float most = 0;
    for (int i = 0; i < l.getLineCount(); i++) most = Math.max(most, l.getLineWidth(i));
    return new double[] { most / density, l.getLineCount() };
  }

  // A picture's shapes (ters_ui's draw ops, in dp from its top left).
  void draw(int id, double[] ops) { View v = views.get(id); if (v instanceof Picture) { ((Picture) v).ops = ops; v.invalidate(); } }

  static final class Picture extends FrameLayout {
    double[] ops = new double[0];
    private final float density;
    private final Paint brush = new Paint(Paint.ANTI_ALIAS_FLAG);
    int id;
    private final MainActivity page;
    Picture(MainActivity c, float density) { super(c); page = c; this.density = density; setWillNotDraw(false); }
    // A finger on the picture goes to the page, which finds the shape under
    // it; while the page follows it, the page doesn't scroll.
    @Override public boolean onTouchEvent(MotionEvent e) {
      int a = e.getActionMasked();
      int kind = a == MotionEvent.ACTION_DOWN ? 0 : a == MotionEvent.ACTION_MOVE ? 1 : a == MotionEvent.ACTION_UP ? 2 : a == MotionEvent.ACTION_CANCEL ? 3 : -1;
      if (kind < 0) return true;
      int heard = page.nativePointer(id, kind, e.getX() / density, e.getY() / density);
      page.tick();
      if (kind == 0) { if (heard == 0) return false; getParent().requestDisallowInterceptTouchEvent(true); }
      return true;
    }
    private float f(double x) { return (float) (x * density); }
    @Override protected void onDraw(Canvas c) {
      super.onDraw(c);
      c.save();
      c.clipRect(0, 0, getWidth(), getHeight());
      Path p = new Path();
      double[] o = ops;
      for (int i = 0; i < o.length;) {
        switch ((int) o[i++]) {
          case 1: p.moveTo(f(o[i]), f(o[i + 1])); i += 2; break;
          case 2: p.lineTo(f(o[i]), f(o[i + 1])); i += 2; break;
          case 3: p.cubicTo(f(o[i]), f(o[i + 1]), f(o[i + 2]), f(o[i + 3]), f(o[i + 4]), f(o[i + 5])); i += 6; break;
          case 4: p.close(); break;
          case 5: {
            int fill = (int) (long) o[i], stroke = (int) (long) o[i + 1], join = (int) o[i + 5];
            float w = f(o[i + 2]);
            if ((fill >>> 24) != 0) { brush.reset(); brush.setAntiAlias(true); brush.setStyle(Paint.Style.FILL); brush.setColor(fill); c.drawPath(p, brush); }
            if ((stroke >>> 24) != 0 && w > 0) {
              brush.reset(); brush.setAntiAlias(true); brush.setStyle(Paint.Style.STROKE); brush.setColor(stroke); brush.setStrokeWidth(w);
              brush.setStrokeJoin(join == 1 ? Paint.Join.ROUND : join == 2 ? Paint.Join.BEVEL : Paint.Join.MITER);
              if (o[i + 3] > 0) brush.setPathEffect(new DashPathEffect(new float[] { f(o[i + 3]), f(o[i + 4] > 0 ? o[i + 4] : o[i + 3]) }, 0));
              c.drawPath(p, brush);
            }
            i += 6;
            p = new Path();
            break;
          }
          default: i = o.length;
        }
      }
      c.restore();
    }
  }

  void page(double w, double h, int bg) {
    ViewGroup.LayoutParams p = page.getLayoutParams();
    p.height = px(h);
    page.setLayoutParams(p);
    scroll.setBackgroundColor(bg);
    getWindow().getDecorView().setBackgroundColor(bg);
  }

  void listen(int id, String event, int handler) {
    final View v = views.get(id);
    // In logcat (tag ters), so the "Android check" workflow shows what the
    // page listens for and what it was told.
    if (!event.equals("frame")) Log.d("ters", "listen " + event + " on " + id + (v == null ? " (no view)" : ""));
    if (v == null) return;
    switch (event) {
      case "click":
        v.setOnClickListener(x -> fire(handler, valueOf(v), ""));
        if (Build.VERSION.SDK_INT >= 23) {
          TypedValue a = new TypedValue();
          getTheme().resolveAttribute(android.R.attr.selectableItemBackground, a, true);
          v.setForeground(getDrawable(a.resourceId));
        }
        break;
      case "input":
        if (v instanceof EditText) ((EditText) v).addTextChangedListener(new TextWatcher() {
          public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
          public void onTextChanged(CharSequence s, int a, int b, int c) {}
          public void afterTextChanged(Editable s) { if (!quiet) fire(handler, s.toString(), ""); }
        });
        break;
      case "keydown":
        if (v instanceof EditText) ((EditText) v).setOnEditorActionListener((t, action, e) -> {
          if (action == EditorInfo.IME_NULL && e != null && e.getAction() != KeyEvent.ACTION_DOWN) return true;
          fire(handler, valueOf(v), "Enter");
          return true;
        });
        break;
      case "pointerdown": case "pointermove": case "pointerup": case "pointercancel": case "pointerleave":
        // A picture finds the shape under the finger itself (Picture).
        if (!(v instanceof Picture)) pointers(v).put(event, handler);
        break;
      case "frame": frames(v, handler); break;
      default: break;
    }
  }

  // A box's pointer events (C199f, tumble's taps): a finger down, moving
  // and up on it, at dp from its top left, as a browser's are in CSS px.
  private final HashMap<View, HashMap<String, Integer>> pointing = new HashMap<>();
  private HashMap<String, Integer> pointers(View v) {
    HashMap<String, Integer> m = pointing.get(v);
    if (m != null) return m;
    final HashMap<String, Integer> hs = new HashMap<>();
    pointing.put(v, hs);
    v.setOnTouchListener((x, e) -> {
      int a = e.getActionMasked();
      String[] names = a == MotionEvent.ACTION_DOWN ? new String[] { "pointerdown" } : a == MotionEvent.ACTION_MOVE ? new String[] { "pointermove" } : a == MotionEvent.ACTION_UP ? new String[] { "pointerup", "pointerleave" } : a == MotionEvent.ACTION_CANCEL ? new String[] { "pointercancel", "pointerleave" } : new String[0];
      boolean heard = false;
      if (a != MotionEvent.ACTION_MOVE) Log.d("ters", "touch " + a + " heard by " + hs.keySet());
      // A box that hears a finger move keeps it (CSS touch-action: none):
      // the page doesn't scroll instead (tumble's drags).
      if (a == MotionEvent.ACTION_DOWN && hs.containsKey("pointermove") && x.getParent() != null) x.getParent().requestDisallowInterceptTouchEvent(true);
      for (String n : names) { Integer h = hs.get(n); if (h != null) { nativeEvent(h, "", "", e.getX() / density, e.getY() / density, 0); heard = true; } }
      if (heard) tick();
      return a == MotionEvent.ACTION_DOWN ? !hs.isEmpty() : heard;
    });
    return hs;
  }

  private String valueOf(View v) { return v instanceof EditText ? ((EditText) v).getText().toString() : ""; }

  private void fire(int handler, String value, String key) { Log.d("ters", "event " + handler); nativeEvent(handler, value, key, 0, 0, 0); tick(); }

  // Once each frame while the view is shown, with the seconds since the
  // frame before (0 the first time), as a browser's frame event.
  private void frames(View v, int handler) {
    Choreographer.getInstance().postFrameCallback(new Choreographer.FrameCallback() {
      long last = -1;
      boolean seen;
      public void doFrame(long nanos) {
        if (v.isAttachedToWindow()) {
          seen = true;
          double seconds = last < 0 ? 0 : (nanos - last) / 1e9;
          last = nanos;
          nativeEvent(handler, "", "", 0, 0, seconds);
          tick();
        } else if (seen) return;
        Choreographer.getInstance().postFrameCallback(this);
      }
    });
  }
}
`;
