FROM nginx:alpine

# ffmpeg generates the synthetic test video; python3 converts the hex key to bytes
RUN apk add --no-cache ffmpeg python3

ARG AES_KEY_HEX=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
ARG KEY_SERVER_URL=http://localhost:8000/key

ENV AES_KEY_HEX=$AES_KEY_HEX
ENV KEY_SERVER_URL=$KEY_SERVER_URL

COPY encrypt.sh /tmp/encrypt.sh
# Copy demo video if provided — otherwise encrypt.sh generates a synthetic one
COPY --chown=root . /tmp/video-src/
RUN [ -f /tmp/video-src/video.mp4 ] && cp /tmp/video-src/video.mp4 /tmp/video.mp4 || true
RUN chmod +x /tmp/encrypt.sh && /tmp/encrypt.sh

COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
