FROM node:18

WORKDIR /app

COPY . /app

RUN sed -i 's/127\.0\.0\.1/kicadgen/g' ./src/ergogen.js

RUN npm install

EXPOSE 3001

CMD ["node", "src/server.js"]


# docker build -t ergogen .
# docker run -p 3001:3001 ergogen
