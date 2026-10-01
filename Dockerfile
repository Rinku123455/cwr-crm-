FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=3000 DATA_FILE=/data/data.json TRUST_PROXY=1
EXPOSE 3000
CMD ["node","server.js"]
