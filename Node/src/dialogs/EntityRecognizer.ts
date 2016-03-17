﻿import utils = require('../utils');
import sprintf = require('sprintf-js');
import chrono = require('chrono-node');

interface ILuisDateTimeEntity extends IEntity {
    resolution: {
        resolution_type: string;
        date?: string;
        time?: string;
        comment?: string;
        duration?: string;
    };
}

interface IChronoDuration extends IEntity {
    resolution: {
        resolution_type: string;
        start: Date;
        end?: Date;
        ref?: Date;
    };
}

export interface IFindMatchResult {
    index: number;
    entity: string;
    score: number;
}

export class EntityRecognizer {
    static yesExp = /^(1|y|yes|yep|sure|ok|true)\z/i;
    static noExp = /^(0|n|no|nope|not|false)\z/i;
    static numberExp = /[+-]?(?:\d+\.?\d*|\d*\.?\d+)/;

    static findEntity(entities: IEntity[], type: string): IEntity {
        for (var i = 0; i < entities.length; i++) {
            if (entities[i].type == type) {
                return entities[i];
            }
        }
        return null;
    }

    static findAllEntities(entities: IEntity[], type: string): IEntity[] {
        var found: IEntity[] = [];
        for (var i = 0; i < entities.length; i++) {
            if (entities[i].type == type) {
                found.push(entities[i]);
            }
        }
        return found;
    }

    static parseTime(utterance: string): Date;
    static parseTime(entities: IEntity[]): Date;
    static parseTime(entities: any): Date {
        if (typeof entities == 'string') {
            entities = EntityRecognizer.recognizeTime(entities);  
        }
        return EntityRecognizer.resolveTime(entities);
    }

    static resolveTime(entities: IEntity[], timezoneOffset?: number): Date {
        var now = new Date();
        var date: string;
        var time: string;
        entities.forEach((entity: ILuisDateTimeEntity) => {
            if (entity.resolution) {
                switch (entity.resolution.resolution_type) {
                    case 'builtin.datetime.date':
                        if (!date) {
                            date = entity.resolution.date;
                        }
                        break;
                    case 'builtin.datetime.time':
                        if (!time) {
                            time = entity.resolution.time;
                            if (time.length == 3) {
                                time = time + ':00:00';
                            } else if (time.length == 6) {
                                time = time + ':00';
                            }
                            // TODO: resolve "ampm" comments
                        }
                        break;
                    case 'chrono.duration':
                        // Date is already calculated
                        var duration = <IChronoDuration>entity;
                        return duration.resolution.start;
                }
            }
        });
        if (date || time) {
            // The user can just say "at 9am" so we'll use today if no date.
            if (!date) {
                date = utils.toDate8601(now);
            }
            if (time) {
                // Append time but adjust timezone. Default is to use bots timezone.
                if (typeof timezoneOffset !== 'number') {
                    timezoneOffset = now.getTimezoneOffset() / 60;
                }
                date = sprintf.sprintf('%s%s%s%02d:00', date, time, (timezoneOffset > 0 ? '-' : '+'), timezoneOffset);
            }
            return new Date(date);
        }
        return null;
    }

    static recognizeTime(utterance: string, refDate?: Date): IChronoDuration {
        var response: IChronoDuration;
        try {
            var results = chrono.parse(utterance, refDate);
            if (results && results.length > 0) {
                var duration = results[0];
                response = {
                    type: 'chrono.duration',
                    entity: duration.text,
                    startIndex: duration.index,
                    endIndex: duration.index + duration.text.length,
                    resolution: {
                        resolution_type: 'chrono.duration',
                        start: duration.start.date()
                    }
                };
                if (duration.end) {
                    response.resolution.end = duration.end.date();
                }
                if (duration.ref) {
                    response.resolution.ref = duration.ref;
                }
                // Calculate a confidence score based on text coverage and call compareConfidence.
                response.score = duration.text.length / utterance.length;
            }
        } catch (err) {
            console.error('Error recognizing time: ' + err.toString());
            response = null;
        }
        return response;
    }

    static parseNumber(utterance: string): number;
    static parseNumber(entities: IEntity[]): number;
    static parseNumber(entities: any): number {
        var entity: IEntity;
        if (typeof entities == 'string') {
            entity = { type: 'text', entity: entities.trim() };
        } else {
            entity = EntityRecognizer.findEntity(entities, 'builtin.number');
        }
        if (entity) {
            var match = this.numberExp.exec(entity.entity);
            if (match) {
                return Number(match[0]);
            }
        }
        return undefined;
    }

    static parseBoolean(utterance: string): boolean {
        utterance = utterance.trim();
        if (EntityRecognizer.yesExp.test(utterance)) {
            return true;
        } else if (EntityRecognizer.noExp.test(utterance)) {
            return false;
        }
        return undefined;
    }

    static findBestMatch(choices: string[], utterance: string, threshold = 0.6): IFindMatchResult {
        var best: IFindMatchResult;
        var matches = EntityRecognizer.findAllMatches(choices, utterance, threshold);
        matches.forEach((value) => {
            if (!best || value.score > best.score) {
                best = value;
            }
        });
        return best;
    }
    
    static findAllMatches(choices: string[], utterance: string, threshold = 0.6): IFindMatchResult[] {
        var matches: IFindMatchResult[] = [];
        utterance = utterance.trim().toLowerCase();
        var tokens = utterance.split(' ');
        choices.forEach((choice, index) => {
            var score = 0.0;
            var value = choice.trim().toLowerCase();
            if (value.indexOf(utterance) >= 0) {
                score = utterance.length / value.length;
            } else if (utterance.indexOf(value) >= 0) {
                score = value.length / utterance.length;
            } else {
                var matched = '';
                tokens.forEach((token) => {
                    if (value.indexOf(token) >= 0) {
                        matched += token;
                    }
                });
                score = matched.length / value.length;
            }
            if (score > threshold) {
                matches.push({ index: index, entity: choice, score: score });
            }
        });
        return matches;
    } 
}