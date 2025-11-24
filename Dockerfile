FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root user
USER root

# Set working directory
WORKDIR /usr/src/app

# Tell Puppeteer NOT to download Chrome (Use the one inside the image)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the bot code
COPY . .

# Run the bot
CMD [ "node", "bot.js" ]