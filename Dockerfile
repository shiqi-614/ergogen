FROM node:18

WORKDIR /usr/src

ADD https://api.github.com/repos/shiqi-614/ergogen/git/refs/heads/develop version.json

WORKDIR /usr/src/app

RUN git clone --recursive https://github.com/shiqi-614/ergogen .

RUN sed -i 's/127\.0\.0\.1/kicadgen/g' ./src/ergogen.js

RUN npm install

EXPOSE 3001

CMD ["node", "src/server.js"]


RUN sed -i 's/127\.0\.0\.1/kicadgen/g' ./src/ergogen.js

RUN npm install

EXPOSE 3001

CMD ["node", "src/server.js"]

# docker build -t ergogen .
# docker run -p 3001:3001 ergogen
