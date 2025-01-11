FROM node:18

WORKDIR /app

COPY . /app

RUN npm install

EXPOSE 3001

CMD ["npm", "run", "start-prod"]


# docker build -t ergogen .
# docker run -p 3001:3001 ergogen
