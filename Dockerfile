FROM node:14

WORKDIR /usr/src

ADD https://api.github.com/repos/shiqi-614/ergogen/git/refs/heads/develop version.json

WORKDIR /usr/src/app

RUN git clone https://github.com/shiqi-614/ergogen .

RUN npm install

EXPOSE 3001

CMD ["node", "src/server.js"]

# docker build -t ergogen .
# docker run -p 3001:3001 ergogen
