#!/bin/bash

# Minimal hermetic pkg-config implementation for the three statically linked
# libraries in the release build. This keeps Homebrew and host pkg-config state
# out of both dependency resolution and FFmpeg's embedded configure string.
set -euo pipefail

case " $* " in
  *" --version "*) echo "short-editor-static-1" ;;
  *" --exists "*) exit 0 ;;
  *" --variable=includedir "*)
    if [[ "$*" == *"freetype2"* ]]; then
      echo "../../prefix/freetype/include"
    elif [[ "$*" == *"harfbuzz"* ]]; then
      echo "../../prefix/harfbuzz/include/harfbuzz"
    else
      echo "../../prefix/x264/include"
    fi
    ;;
  *" --cflags-only-I "*|*" --cflags "*)
    if [[ "$*" == *"freetype2"* ]]; then
      echo "-I../../prefix/freetype/include/freetype2"
    elif [[ "$*" == *"harfbuzz"* ]]; then
      echo "-I../../prefix/harfbuzz/include/harfbuzz -I../../prefix/freetype/include/freetype2"
    else
      echo "-I../../prefix/x264/include"
    fi
    ;;
  *" --libs "*)
    if [[ "$*" == *"freetype2"* ]]; then
      echo "-L../../prefix/freetype/lib -lfreetype"
    elif [[ "$*" == *"harfbuzz"* ]]; then
      echo "-L../../prefix/harfbuzz/lib -lharfbuzz -L../../prefix/freetype/lib -lfreetype -lc++ -framework CoreText -framework CoreGraphics -framework CoreFoundation"
    else
      echo "-L../../prefix/x264/lib -lx264 -lpthread -lm"
    fi
    ;;
  *) exit 1 ;;
esac
