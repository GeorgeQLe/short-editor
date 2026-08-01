#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${script_dir}/common.sh"
require_arm64_macos

release_work_root="${SHORT_EDITOR_RELEASE_WORK:-${release_repo_root}/build/release-inputs}"
release_downloads="${release_work_root}/downloads"
release_sources="${release_work_root}/sources"
release_prefix="${release_work_root}/prefix"
release_output="${release_repo_root}/resources/bin"

mkdir -p "${release_downloads}" "${release_sources}" "${release_prefix}" "${release_output}"
download_verified "${FFMPEG_URL}" "${FFMPEG_SHA256}" \
  "${release_downloads}/ffmpeg-${FFMPEG_VERSION}.tar.xz"
download_verified "${X264_URL}" "${X264_SHA256}" \
  "${release_downloads}/x264-${X264_REVISION}.tar.gz"
download_verified "${FREETYPE_URL}" "${FREETYPE_SHA256}" \
  "${release_downloads}/freetype-${FREETYPE_VERSION}.tar.xz"
download_verified "${HARFBUZZ_URL}" "${HARFBUZZ_SHA256}" \
  "${release_downloads}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz"

rm -rf \
  "${release_sources}/ffmpeg-${FFMPEG_VERSION}" \
  "${release_sources}/x264-${X264_REVISION}" \
  "${release_sources}/freetype-${FREETYPE_VERSION}" \
  "${release_sources}/harfbuzz-${HARFBUZZ_VERSION}" \
  "${release_prefix}/x264" \
  "${release_prefix}/freetype" \
  "${release_prefix}/harfbuzz"
tar -xf "${release_downloads}/ffmpeg-${FFMPEG_VERSION}.tar.xz" -C "${release_sources}"
tar -xf "${release_downloads}/x264-${X264_REVISION}.tar.gz" -C "${release_sources}"
tar -xf "${release_downloads}/freetype-${FREETYPE_VERSION}.tar.xz" -C "${release_sources}"
tar -xf "${release_downloads}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz" -C "${release_sources}"

export MACOSX_DEPLOYMENT_TARGET="14.0"
export SOURCE_DATE_EPOCH="1781653653"
release_sdk="$(xcrun --sdk macosx --show-sdk-path)"
release_cflags="-arch arm64 -mmacosx-version-min=14.0 -isysroot ${release_sdk} -O2"
third_party_cflags="${release_cflags} -ffile-prefix-map=${release_work_root}=."
release_ldflags="-arch arm64 -mmacosx-version-min=14.0 -isysroot ${release_sdk}"

pushd "${release_sources}/x264-${X264_REVISION}" >/dev/null
./configure \
  --prefix="../../prefix/x264" \
  --host=aarch64-apple-darwin \
  --enable-static \
  --disable-cli \
  --disable-opencl \
  --extra-cflags="${third_party_cflags}" \
  --extra-ldflags="${release_ldflags}"
make -j"$(release_jobs)"
make install
popd >/dev/null

pushd "${release_sources}/freetype-${FREETYPE_VERSION}" >/dev/null
./configure \
  --prefix="${release_prefix}/freetype" \
  --disable-shared \
  --enable-static \
  --without-brotli \
  --without-bzip2 \
  --without-harfbuzz \
  --without-png \
  --without-zlib \
  CFLAGS="${third_party_cflags}" \
  LDFLAGS="${release_ldflags}"
make -j"$(release_jobs)"
make install
popd >/dev/null

cmake -S "${release_sources}/harfbuzz-${HARFBUZZ_VERSION}" \
  -B "${release_sources}/harfbuzz-${HARFBUZZ_VERSION}/build-static" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DCMAKE_OSX_SYSROOT="${release_sdk}" \
  -DCMAKE_INSTALL_PREFIX="${release_prefix}/harfbuzz" \
  -DCMAKE_PREFIX_PATH="${release_prefix}/freetype" \
  -DBUILD_SHARED_LIBS=OFF \
  -DHB_BUILD_UTILS=OFF \
  -DHB_BUILD_TESTS=OFF \
  -DHB_HAVE_FREETYPE=ON \
  -DHB_HAVE_GLIB=OFF \
  -DHB_HAVE_GOBJECT=OFF \
  -DHB_HAVE_GRAPHITE2=OFF \
  -DHB_HAVE_ICU=OFF
cmake --build "${release_sources}/harfbuzz-${HARFBUZZ_VERSION}/build-static" \
  --parallel "$(release_jobs)"
cmake --install "${release_sources}/harfbuzz-${HARFBUZZ_VERSION}/build-static"

pushd "${release_sources}/ffmpeg-${FFMPEG_VERSION}" >/dev/null
./configure \
  --prefix="../../prefix/ffmpeg" \
  --arch=arm64 \
  --target-os=darwin \
  --cc="$(xcrun --find clang)" \
  --host-cc="$(xcrun --find clang)" \
  --host-cflags="${release_cflags}" \
  --host-ldflags="${release_ldflags}" \
  --pkg-config="../../../../scripts/release/pkg-config-static.sh" \
  --pkg-config-flags=--static \
  --extra-cflags="${release_cflags} -ffile-prefix-map=${release_work_root}=. -I../../prefix/x264/include -I../../prefix/freetype/include/freetype2 -I../../prefix/harfbuzz/include/harfbuzz" \
  --extra-ldflags="${release_ldflags} -L../../prefix/x264/lib -L../../prefix/freetype/lib -L../../prefix/harfbuzz/lib" \
  --disable-autodetect \
  --disable-debug \
  --disable-doc \
  --disable-htmlpages \
  --disable-manpages \
  --disable-podpages \
  --disable-txtpages \
  --disable-shared \
  --disable-everything \
  --disable-network \
  --enable-static \
  --enable-small \
  --enable-gpl \
  --enable-ffmpeg \
  --enable-ffprobe \
  --enable-avcodec \
  --enable-avformat \
  --enable-avfilter \
  --enable-swresample \
  --enable-swscale \
  --enable-libx264 \
  --enable-libfreetype \
  --enable-libharfbuzz \
  --enable-zlib \
  --enable-audiotoolbox \
  --enable-videotoolbox \
  --enable-avfoundation \
  --enable-protocol=file,pipe \
  --enable-indev=lavfi \
  --enable-decoder=wrapped_avframe,h264,hevc,mpeg4,vp8,vp9,av1,prores,mjpeg,png,gif,aac,ac3,eac3,mp3,flac,opus,vorbis,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,alac \
  --enable-encoder=libx264,aac,rawvideo,pcm_s16le \
  --enable-demuxer=mov,matroska,avi,mpegts,mpegvideo,mp3,wav,flac,ogg,image2,concat \
  --enable-muxer=mp4,mov,matroska,webm,null,rawvideo,framecrc,wav \
  --enable-parser=h264,hevc,mpeg4video,vp8,vp9,av1,aac,ac3,mpegaudio,opus,vorbis \
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb \
  --enable-filter=afade,aformat,amix,anull,anullsrc,aresample,asetrate,asetpts,asplit,atrim,color,concat,crop,drawtext,fade,format,fps,null,overlay,pad,scale,setpts,sine,split,trim,volume \
  --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox
sed -i '' "s#${release_work_root}#.#g" config.h ffbuild/config.mak
make -j"$(release_jobs)"
install -m 0755 ffmpeg "${release_output}/ffmpeg"
install -m 0755 ffprobe "${release_output}/ffprobe"
popd >/dev/null

node "${script_dir}/smoke-ffmpeg.mjs" \
  "${release_output}/ffmpeg" \
  "${release_output}/ffprobe" \
  "${release_repo_root}/resources/fonts/Inter-Regular.otf"
reject_nonredistributable_paths "${release_output}/ffmpeg"
reject_nonredistributable_paths "${release_output}/ffprobe"

echo "Built redistributable arm64 FFmpeg ${FFMPEG_VERSION} with x264 ${X264_VERSION}."
