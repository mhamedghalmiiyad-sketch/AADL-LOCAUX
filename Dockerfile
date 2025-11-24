FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Install standard dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

# Run the bot
CMD [ "node", "bot.js" ]