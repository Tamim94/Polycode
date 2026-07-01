FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_WS_URL=ws://localhost:8080
ARG VITE_KEY_SERVER_URL=http://localhost:8000
ARG VITE_VIDEO_SERVER_URL=http://localhost:8082

ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_KEY_SERVER_URL=$VITE_KEY_SERVER_URL
ENV VITE_VIDEO_SERVER_URL=$VITE_VIDEO_SERVER_URL

# ffmpeg generates the offline sample video for the 1A player demo
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm install
COPY . .

# Use provided sample.mp4 if present, otherwise generate a synthetic one
RUN mkdir -p public && [ -f public/sample.mp4 ] || ffmpeg -y \
  -f lavfi -i "testsrc=duration=15:size=640x360:rate=24" \
  -f lavfi -i "sine=frequency=440:duration=15" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset fast -crf 32 -c:a aac -b:a 64k \
  public/sample.mp4

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
