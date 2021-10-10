FROM node:14-buster

RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY . /autorender
RUN cd /autorender && \
    npm install && \
    npm run build

RUN mkdir /in /out /final && \
    ln -s /in /autorender/dist/in && \
    ln -s /out /autorender/dist/out && \
    ln -s /final /autorender/dist/final

COPY ./autorender.sh /

ENTRYPOINT [ "/autorender.sh" ]
