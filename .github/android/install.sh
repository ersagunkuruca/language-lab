#!/bin/sh
# Each APK in apks/, in order, installed over what is there (Android app
# install check): stops at the first one Android refuses, with its reason.
set -e
for apk in $(ls apks/*.apk | sort -V); do
  echo "== install $apk"
  adb install -r "$apk"
done
adb shell pm list packages | grep -E 'app\.(ters|lab)\.' | sort
