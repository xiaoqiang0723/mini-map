FROM node:alpine
WORKDIR /mini-map-app
RUN  apk add tzdata --update --no-cache \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" /etc/localtime \
    && apk del tzdata
COPY ./package.json ./package.json

RUN  apk add --no-cache python make g++ \
    && npm i --production \
    && npm cache clean --force \
    && apk del python make g++

COPY ./config.js ./config.js

CMD node . --mini-map-app-name="mini-map"

EXPOSE 80
