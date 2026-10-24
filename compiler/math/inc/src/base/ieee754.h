// What ieee754.cc needs from V8 and the C++ library, so clang can build it
// for WebAssembly with no system headers (gen.ts). bit_cast as memcpy, the
// wraparound helpers on unsigned ints.
#include <cstdint>
#include <cstring>
#define V8_WARN_UNUSED_RESULT
#define V8_INLINE inline
#define V8_CC_MSVC 0
namespace v8 { namespace base {
template <class D, class S> inline D bit_cast(const S& s) { D d; std::memcpy(&d, &s, sizeof d); return d; }
template <class T> inline T NegateWithWraparound(T a) { return (T)(0u - (uint32_t)a); }
inline double Divide(double a, double b) { return a / b; }
inline int32_t SubWithWraparound(int32_t a, int32_t b) { return (int32_t)((uint32_t)a - (uint32_t)b); }
namespace ieee754 { double log1p(double); double expm1(double); double atan(double); double sin(double); double cos(double); double tan(double); double exp(double); double log(double); double pow(double,double); double atan2(double,double); } } }
