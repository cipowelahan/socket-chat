const app = require('express')()
const server = require('http').createServer(app)
const { Server } = require('socket.io')
const io = new Server(server)
const port = process.env.PORT || 3000
const { Sequelize, DataTypes, Op } = require('sequelize')

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './sqllite.sqlite3'
})

const User = sequelize.define('user', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'users',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['username']
        }
    ]
})
User.sync({ alter: true, logging: false })
    .then(() => {
        console.log('user created successfully')
    })
    .catch((err) => {
        console.log('failed create user')
        console.log(err)
    })

const Room = sequelize.define('room', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING
    },
    type: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'rooms'
})
Room.sync({ alter: true, logging: false })
    .then(() => {
        console.log('room created successfully')
    })
    .catch((err) => {
        console.log('failed create room')
        console.log(err)
    })

const RoomUser = sequelize.define('roomUser', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    room_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    }
}, {
    tableName: 'room_users'
})
RoomUser.sync({ alter: true, logging: false })
    .then(() => {
        console.log('roomUser created successfully')
    })
    .catch((err) => {
        console.log('failed create roomUser')
        console.log(err)
    })

const RoomMessage = sequelize.define('roomMessage', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    room_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT
    }
}, {
    tableName: 'room_messages'
})
RoomMessage.sync({ alter: true, logging: false })
    .then(() => {
        console.log('roomMessage created successfully')
    })
    .catch((err) => {
        console.log('failed create roomMessage')
        console.log(err)
    })

Room.hasMany(RoomUser, {
    as: 'users',
    foreignKey: 'room_id'
})
Room.hasMany(RoomMessage, {
    as: 'messages',
    foreignKey: 'room_id'
})
RoomMessage.belongsTo(User, {
    as: 'user',
    foreignKey: 'user_id'
})


app.get('/', ({ res }) => {
    res.sendFile(__dirname + '/index.html')
})

io.on('connection', socket => {
    console.log('new connection from ' + socket.id)

    socket.on('login', async (username) => {
        const checkUser = await User.findOrCreate({ where: {
            username: username
        }})
        const user = checkUser[0].toJSON()

        const rooms = await Room.findAll({
            include: {
                model: RoomUser,
                as: 'users',
                where: {
                    user_id: user.id
                }
            }
        })

        for (const room of rooms) {
            socket.join(`room:${room.id}`)
        }

        io.to(socket.id).emit('login', user)
        io.emit('getUsers')
    })

    socket.on('getUsers', async (data) => {
        const users = await User.findAll({
            where: {
                id: {
                    [Op.ne]: data
                }
            }
        })

        io.to(socket.id).emit('users', users)
    })

    socket.on('getMessages', async (data) => {
        const { userId, otherId } = data
        let selectedRoomId = null

        const roomOther = await Room.findAll({
            include: {
                model: RoomUser,
                as: 'users',
                where: {
                    user_id: otherId
                }
            }
        })

        let room = null
        if (roomOther.length !== 0) {
            const roomOtherIds = roomOther.map(m => m.id)
            room = await Room.findOne({
                include: {
                    model: RoomUser,
                    as: 'users',
                    where: {
                        user_id: userId
                    }
                },
                where: {
                    id: {
                        [Op.in]: roomOtherIds
                    }
                }
            })

        }

        if (room === null) {
            const newRoom = await Room.create({
                name: 'private room',
                type: 'private'
            })

            selectedRoomId = newRoom.id
            for (const id of [userId, otherId]) {
                await RoomUser.create({
                    room_id: selectedRoomId,
                    user_id: id
                })
            }
            
        } else {
            selectedRoomId = room.id
        }
        
        socket.join(`room:${selectedRoomId}`)

        const messages = await RoomMessage.findAll({
            include: {
                model: User,
                as: 'user'
            },
            where: {
                room_id: selectedRoomId
            }
        })

        io.to(socket.id).emit('getMessages', { room_id: selectedRoomId, messages })

    })

    socket.on('sendMessage', async (data) => {
        const { room_id, user_id, message } = data
        await RoomMessage.create({ room_id, user_id, message })

        const messages = await RoomMessage.findAll({
            include: {
                model: User,
                as: 'user'
            },
            where: {
                room_id: room_id
            }
        })

        const user = await User.findOne({
            where: {
                id: user_id
            }
        })

        const notif = {
            user_id,
            head: user.username,
            body: message
        }

        io.to(`room:${room_id}`).emit('getMessages', { room_id: room_id, messages })
        io.to(`room:${room_id}`).emit('notif', notif)

        const users = await RoomUser.findAll({
            where: {
                room_id: room_id,
                user_id: {
                    [Op.ne]: user_id
                }
            }
        })

        for (const userjoin of users) {
            socket.broadcast.emit('joinRoom', {
                room_id,
                user_id: userjoin.user_id,
                notif
            })
        }

    })

    socket.on('joinRoom', (data) => {
        const { room_id, notif } = data
        if(!socket.rooms.has(`room:${room_id}`)) {
            socket.join(`room:${room_id}`)
            io.to(`room:${room_id}`).emit('notif', notif)
        }
    })

})

server.listen(port, '0.0.0.0', () => {
    console.log(`server listen on port ${port}`)
})