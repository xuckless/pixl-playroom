// Playroom's display reader (macOS): a screen's EDR headroom, which
// Electron does not expose. Engine 0.18 never probes a display: the host
// sends `Ceiling::Display { white_nits: 203, peak_nits: 203 · H }` with H
// read here (integration guide §4.5). Built by scripts/build-native.mjs.
#import <AppKit/AppKit.h>
#include <node_api.h>

// The NSScreen whose CGDirectDisplayID is `id` (Electron's display id on
// macOS), or the main screen when none matches.
static NSScreen *screenFor(uint32_t id) {
  for (NSScreen *s in [NSScreen screens]) {
    NSNumber *n = [s deviceDescription][@"NSScreenNumber"];
    if (n && [n unsignedIntValue] == id) return s;
  }
  return [NSScreen mainScreen];
}

static void set(napi_env env, napi_value obj, const char *key, double v) {
  napi_value x;
  napi_create_double(env, v, &x);
  napi_set_named_property(env, obj, key, x);
}

// headroom(displayId) → { current, potential, reference }: the EDR headroom
// now (it moves with the brightness slider and ambient light), the most the
// screen can reach, and its reference mode's (0 when none).
static napi_value Headroom(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t id = 0;
  if (argc > 0) napi_get_value_uint32(env, argv[0], &id);
  napi_value out;
  napi_create_object(env, &out);
  @autoreleasepool {
    NSScreen *s = screenFor(id);
    if (!s) return out;
    set(env, out, "current", [s maximumExtendedDynamicRangeColorComponentValue]);
    set(env, out, "potential", [s maximumPotentialExtendedDynamicRangeColorComponentValue]);
    double reference = 0;
    if (@available(macOS 10.15, *)) reference = [s maximumReferenceExtendedDynamicRangeColorComponentValue];
    set(env, out, "reference", reference);
  }
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "headroom", NAPI_AUTO_LENGTH, Headroom, nullptr, &fn);
  napi_set_named_property(env, exports, "headroom", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
