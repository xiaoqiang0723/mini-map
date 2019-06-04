FROM node:alpine
RUN apk add tzdata --update --no-cache && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && echo "Asia/Shanghai" /etc/localtime && apk del tzdata
WORKDIR /mini-map-app/
COPY ./package.json ./package.json
RUN apk add --no-cache python make g++ && npm i --production && npm cache clean --force && apk del python make g++
COPY ./config.js ./config.js
VOLUME /mini-map
CMD node . --mini-map-app-name="mini-map"

EXPOSE 80
