package database

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path"
	"strings"
	"time"

	"github.com/alireza0/s-ui/config"
	"github.com/alireza0/s-ui/database/model"
	slogger "github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/util/common"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var db *gorm.DB

func initUser() error {
	var count int64
	err := db.Model(&model.User{}).Count(&count).Error
	if err != nil {
		return err
	}
	if count == 0 {
		user := &model.User{
			Username: "admin",
			Password: "admin",
		}
		return db.Create(user).Error
	}
	return nil
}

func OpenDB(dbPath string) error {
	dir := path.Dir(dbPath)
	err := os.MkdirAll(dir, 01740)
	if err != nil {
		return err
	}

	var gormLogger logger.Interface

	if config.IsDebug() {
		gormLogger = logger.Default
	} else {
		gormLogger = logger.Discard
	}

	c := &gorm.Config{
		Logger: gormLogger,
	}
	sep := "?"
	if strings.Contains(dbPath, "?") {
		sep = "&"
	}
	// _cache_size=-200 caps each connection's page cache at ~200 KiB
	// (default is ~2 MiB), reducing memory amplification if a connection
	// escapes the pool.
	// _txlock=immediate makes transactions take the write lock up front.
	// Deferred transactions that read first and then write (e.g. the deplete
	// job) cannot wait on the lock upgrade and fail instantly with "database
	// is locked" whenever another writer (stats job) is active (#1209).
	dsn := dbPath + sep + "_busy_timeout=10000&_journal_mode=WAL&_cache_size=-200&_txlock=immediate"
	db, err = gorm.Open(sqlite.Open(dsn), c)
	if err != nil {
		return err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(time.Hour)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	if config.IsDebug() {
		db = db.Debug()
	}
	return nil
}

func InitDB(dbPath string) error {
	err := OpenDB(dbPath)
	if err != nil {
		return err
	}

	// Default Outbounds
	if !db.Migrator().HasTable(&model.Outbound{}) {
		db.Migrator().CreateTable(&model.Outbound{})
		defaultOutbound := []model.Outbound{
			{Type: "direct", Tag: "direct", Options: json.RawMessage(`{}`)},
		}
		db.Create(&defaultOutbound)
	}

	err = db.AutoMigrate(
		&model.Setting{},
		&model.Tls{},
		&model.Inbound{},
		&model.Outbound{},
		&model.Service{},
		&model.Endpoint{},
		&model.User{},
		&model.Tokens{},
		&model.Stats{},
		&model.Client{},
		&model.Changes{},
		&model.Server{},
	)
	if err != nil {
		return err
	}
	err = initUser()
	if err != nil {
		return err
	}
	// 给还没有订阅令牌的客户端补一个（老库升级、以及导入旧备份之后）。
	// 失败不阻断启动：没有令牌时旧的"按名字订阅"仍然可用。
	if err := backfillClientSubTokens(); err != nil {
		slogger.Warning("backfill client sub_token failed:", err)
	}

	return nil
}

// RandomSubToken 生成 32 位小写 hex 的订阅令牌（与面板侧 randHex(16) 对齐）。
//
// 随机源不可用时**返回错误**，绝不退化成时间戳：
// 订阅令牌就是凭据，可预测的令牌等于没有令牌（原来那条退化路径熵约 60 bit
// 且与时间强相关，还会在极端短时间戳下切片越界）。
func RandomSubToken() (string, error) {
	b := make([]byte, 16)
	for i := 0; i < 3; i++ {
		if _, err := rand.Read(b); err == nil {
			return hex.EncodeToString(b), nil
		}
	}
	return "", common.NewError("无法生成订阅令牌：系统随机源不可用")
}

// backfillClientSubTokens 幂等地给缺令牌的客户端补令牌。
func backfillClientSubTokens() error {
	conn := GetDB()
	var ids []uint
	if err := conn.Model(&model.Client{}).
		Where("sub_token = '' OR sub_token IS NULL").
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		tok, err := RandomSubToken()
		if err != nil {
			return err
		}
		if err := conn.Model(&model.Client{}).Where("id = ?", id).
			Update("sub_token", tok).Error; err != nil {
			return err
		}
	}
	if len(ids) > 0 {
		slogger.Info("backfilled sub_token for ", len(ids), " client(s)")
	}
	return nil
}

func GetDB() *gorm.DB {
	return db
}

func IsNotFound(err error) bool {
	// errors.Is 而不是 ==：一旦上层开始 wrap（fmt.Errorf("%w")），
	// 裸等值比较会把"查不到"误判成 500，或把 500 误判成 404。
	return errors.Is(err, gorm.ErrRecordNotFound)
}
